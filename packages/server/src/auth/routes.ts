import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuid } from 'uuid';
import { config } from '../config.js';
import { getDb } from '../db/schema.js';
import { authenticate, AuthRequest } from './middleware.js';
import type { User } from '../types/index.js';

const router = Router();

function getSetting(key: string, defaultValue: any): any {
  const row = getDb().prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as any;
  if (!row) return defaultValue;
  try { return JSON.parse(row.value); } catch { return defaultValue; }
}

router.post('/register', (req: AuthRequest, res: Response) => {
  const { email, password, display_name, invite_token } = req.body;
  if (!email || !password || !display_name) {
    return res.status(400).json({ error: 'email, password, and display_name required' });
  }

  const db = getDb();
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return res.status(409).json({ error: 'Email already registered' });

  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;

  // First user always gets superadmin — no invite needed
  if (userCount === 0) {
    const id = uuid();
    const password_hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)')
      .run(id, email, password_hash, display_name, 'superadmin');
    const token = jwt.sign({ userId: id }, config.jwtSecret, { expiresIn: '7d' });
    return res.status(201).json({ token, user: { id, email, display_name, role: 'superadmin' } });
  }

  // Check if self-registration is allowed
  const selfRegistrationAllowed = getSetting('allow_self_registration', false);

  // If invite token provided, validate it
  if (invite_token) {
    const invite = db.prepare(
      'SELECT * FROM invites WHERE token = ? AND accepted_at IS NULL'
    ).get(invite_token) as any;

    if (!invite) {
      return res.status(400).json({ error: 'Invalid or expired invite token' });
    }
    if (new Date(invite.expires_at) < new Date()) {
      return res.status(400).json({ error: 'Invite has expired' });
    }
    if (invite.email.toLowerCase() !== email.toLowerCase()) {
      return res.status(400).json({ error: 'Email does not match the invitation' });
    }

    const id = uuid();
    const password_hash = bcrypt.hashSync(password, 10);
    const role = invite.role || 'viewer';

    db.prepare('INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)')
      .run(id, email, password_hash, display_name, role);
    db.prepare('UPDATE invites SET accepted_at = datetime(?) WHERE id = ?')
      .run(new Date().toISOString(), invite.id);

    const token = jwt.sign({ userId: id }, config.jwtSecret, { expiresIn: '7d' });
    return res.status(201).json({ token, user: { id, email, display_name, role } });
  }

  // No invite token — check if self-registration is allowed
  if (!selfRegistrationAllowed) {
    return res.status(403).json({ error: 'Registration requires an invite. Contact your admin for an invitation link.' });
  }

  // Self-registration: assign viewer role
  const id = uuid();
  const password_hash = bcrypt.hashSync(password, 10);
  db.prepare('INSERT INTO users (id, email, password_hash, display_name, role) VALUES (?,?,?,?,?)')
    .run(id, email, password_hash, display_name, 'viewer');

  const token = jwt.sign({ userId: id }, config.jwtSecret, { expiresIn: '7d' });
  res.status(201).json({ token, user: { id, email, display_name, role: 'viewer' } });
});

router.post('/login', (req: AuthRequest, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }

  const db = getDb();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as User | undefined;
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  if (user.status === 'suspended') {
    return res.status(403).json({ error: 'Account suspended. Contact your administrator.' });
  }

  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);

  const token = jwt.sign({ userId: user.id }, config.jwtSecret, { expiresIn: '7d' });
  res.json({
    token,
    user: {
      id: user.id, email: user.email, display_name: user.display_name,
      role: user.role, must_change_password: !!user.must_change_password,
    },
  });
});

router.get('/me', authenticate, (req: AuthRequest, res: Response) => {
  const u = req.user!;
  res.json({
    id: u.id, email: u.email, display_name: u.display_name,
    role: u.role, must_change_password: !!u.must_change_password,
  });
});

router.post('/force-change-password', authenticate, (req: AuthRequest, res: Response) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }

  const db = getDb();
  const password_hash = bcrypt.hashSync(new_password, 10);
  db.prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?')
    .run(password_hash, req.user!.id);

  res.json({ success: true });
});

/** GET /auth/registration-info — public endpoint to check if self-registration is allowed */
router.get('/registration-info', (_req: AuthRequest, res: Response) => {
  const db = getDb();
  const userCount = (db.prepare('SELECT COUNT(*) as c FROM users').get() as any).c;
  const selfRegistrationAllowed = getSetting('allow_self_registration', false);
  res.json({
    self_registration: selfRegistrationAllowed,
    is_first_user: userCount === 0,
  });
});

/** GET /auth/invite/:token — validate an invite token (public) */
router.get('/invite/:token', (_req: AuthRequest, res: Response) => {
  const db = getDb();
  const invite = db.prepare(
    'SELECT id, email, role, expires_at, accepted_at FROM invites WHERE token = ?'
  ).get(_req.params.token) as any;

  if (!invite) return res.status(404).json({ error: 'Invite not found' });
  if (invite.accepted_at) return res.status(400).json({ error: 'Invite already used' });
  if (new Date(invite.expires_at) < new Date()) return res.status(400).json({ error: 'Invite has expired' });

  res.json({ email: invite.email, role: invite.role });
});

export default router;
