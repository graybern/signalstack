/**
 * OpenAPI 3.0 Specification for SignalStack API
 *
 * Served at GET /api/docs/openapi.json
 */

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'SignalStack API',
    description: 'AI-Powered Prospect Intelligence — Stack signals from 14+ sources, qualify leads with AI, and arm your reps with intelligence briefs.',
    version: '1.0.0',
    contact: {
      name: 'SignalStack',
    },
  },
  servers: [
    { url: '/api', description: 'Current server' },
    { url: '/api/v1', description: 'API v1 (canonical)' },
  ],
  tags: [
    { name: 'Auth', description: 'Authentication endpoints' },
    { name: 'Leads', description: 'Lead management and intelligence briefs' },
    { name: 'Campaigns', description: 'Research campaign management' },
    { name: 'Inbound', description: 'Inbound lead import (CSV, manual, webhook)' },
    { name: 'ICP', description: 'Ideal Customer Profile configuration' },
    { name: 'Data Sources', description: 'Enrichment source management' },
    { name: 'Exports', description: 'Export to outreach tools' },
    { name: 'Webhooks', description: 'Outbound webhook subscriptions' },
    { name: 'Events', description: 'Real-time event streaming (SSE)' },
    { name: 'Runs', description: 'Pipeline run history' },
  ],
  paths: {
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Register a new user',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password', 'display_name'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 6 },
                  display_name: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'User registered, returns JWT token' },
          '400': { description: 'Validation error' },
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login and receive JWT token',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'JWT token returned' },
          '401': { description: 'Invalid credentials' },
        },
      },
    },
    '/leads': {
      get: {
        tags: ['Leads'],
        summary: 'List leads with filters',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'segment', in: 'query', schema: { type: 'string', enum: ['ENT', 'MM', 'SMB'] } },
          { name: 'source_type', in: 'query', schema: { type: 'string', enum: ['outbound_research', 'outbound_campaign', 'inbound_csv', 'inbound_manual', 'inbound_webhook'] } },
          { name: 'lead_status', in: 'query', schema: { type: 'string', enum: ['imported', 'enriching', 'scored', 'qualified', 'disqualified', 'contacted', 'won', 'lost'] } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'sort', in: 'query', schema: { type: 'string', default: 'fit_score' } },
          { name: 'order', in: 'query', schema: { type: 'string', enum: ['asc', 'desc'], default: 'desc' } },
        ],
        responses: {
          '200': { description: 'Paginated lead list' },
        },
      },
    },
    '/leads/{id}': {
      get: {
        tags: ['Leads'],
        summary: 'Get lead detail with personas and brief',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Full lead detail' },
          '404': { description: 'Lead not found' },
        },
      },
    },
    '/campaigns': {
      get: {
        tags: ['Campaigns'],
        summary: 'List research campaigns',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Campaign list' } },
      },
      post: {
        tags: ['Campaigns'],
        summary: 'Create a research campaign',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'pattern_thesis'],
                properties: {
                  name: { type: 'string' },
                  pattern_thesis: { type: 'string' },
                  description: { type: 'string' },
                  target_count: { type: 'integer', default: 12 },
                  example_companies: { type: 'array', items: { type: 'string' } },
                  target_signals: { type: 'array', items: { type: 'string' } },
                  search_patterns: { type: 'array', items: { type: 'string' } },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Campaign created' } },
      },
    },
    '/campaigns/{id}/run': {
      post: {
        tags: ['Campaigns'],
        summary: 'Execute a campaign research run',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: 'Run started, returns run_id' },
          '404': { description: 'Campaign not found' },
        },
      },
    },
    '/inbound/upload': {
      post: {
        tags: ['Inbound'],
        summary: 'Upload CSV of leads for qualification',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  file: { type: 'string', format: 'binary' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Import started' } },
      },
    },
    '/inbound/single': {
      post: {
        tags: ['Inbound'],
        summary: 'Add a single lead for qualification',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['company_name'],
                properties: {
                  company_name: { type: 'string' },
                  domain: { type: 'string' },
                  segment: { type: 'string', enum: ['ENT', 'MM', 'SMB'] },
                  contact_name: { type: 'string' },
                  contact_email: { type: 'string' },
                  contact_title: { type: 'string' },
                  notes: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Lead import started' } },
      },
    },
    '/inbound/webhook': {
      post: {
        tags: ['Inbound'],
        summary: 'Receive leads via webhook (API key auth)',
        security: [{ apiKeyAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                oneOf: [
                  { type: 'object', properties: { company_name: { type: 'string' }, domain: { type: 'string' } } },
                  { type: 'array', items: { type: 'object', properties: { company_name: { type: 'string' }, domain: { type: 'string' } } } },
                ],
              },
            },
          },
        },
        responses: {
          '200': { description: 'Leads accepted for processing' },
          '401': { description: 'Invalid API key' },
        },
      },
    },
    '/webhooks': {
      get: {
        tags: ['Webhooks'],
        summary: 'List outbound webhook subscriptions',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Webhook subscription list' } },
      },
      post: {
        tags: ['Webhooks'],
        summary: 'Create an outbound webhook subscription',
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['url', 'events'],
                properties: {
                  url: { type: 'string', format: 'uri' },
                  events: { type: 'array', items: { type: 'string' }, description: 'Event types to subscribe to. Use * for all, lead.* for prefix match.' },
                  secret: { oneOf: [{ type: 'boolean' }, { type: 'string' }], description: 'HMAC signing secret. Pass true to auto-generate.' },
                  name: { type: 'string' },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '201': { description: 'Subscription created' } },
      },
    },
    '/webhooks/{id}/test': {
      post: {
        tags: ['Webhooks'],
        summary: 'Send a test event to a webhook endpoint',
        security: [{ bearerAuth: [] }],
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Test event sent' } },
      },
    },
    '/webhooks/{id}/deliveries': {
      get: {
        tags: ['Webhooks'],
        summary: 'View webhook delivery log',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer' } },
          { name: 'limit', in: 'query', schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'Delivery log with pagination' } },
      },
    },
    '/events/stream': {
      get: {
        tags: ['Events'],
        summary: 'Real-time event stream (Server-Sent Events)',
        security: [{ bearerAuth: [] }],
        parameters: [
          { name: 'types', in: 'query', schema: { type: 'string' }, description: 'Comma-separated event types to filter' },
        ],
        responses: {
          '200': {
            description: 'SSE event stream',
            content: { 'text/event-stream': { schema: { type: 'string' } } },
          },
        },
      },
    },
    '/events/types': {
      get: {
        tags: ['Events'],
        summary: 'List all available event types',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Event type catalog' } },
      },
    },
    '/exports/salesforce-csv': {
      get: {
        tags: ['Exports'],
        summary: 'Export leads as Salesforce-compatible CSV',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'CSV file download' } },
      },
    },
    '/data-sources': {
      get: {
        tags: ['Data Sources'],
        summary: 'List all enrichment data sources',
        security: [{ bearerAuth: [] }],
        responses: { '200': { description: 'Data source list with status' } },
      },
    },
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        responses: {
          '200': { description: 'Server is healthy', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string' }, time: { type: 'string' } } } } } },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT token from /auth/login',
      },
      apiKeyAuth: {
        type: 'apiKey',
        in: 'header',
        name: 'x-api-key',
        description: 'Webhook API key from Settings',
      },
    },
    schemas: {
      Lead: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          company_name: { type: 'string' },
          segment: { type: 'string', enum: ['ENT', 'MM', 'SMB'] },
          fit_score: { type: 'integer', minimum: 0, maximum: 100 },
          fit_score_label: { type: 'string' },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          source_type: { type: 'string' },
          lead_status: { type: 'string' },
          convergence_score: { type: 'integer' },
          brief_markdown: { type: 'string' },
        },
      },
      SignalStackEvent: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Unique event ID' },
          type: { type: 'string', description: 'Event type (e.g., lead.qualified)' },
          timestamp: { type: 'string', format: 'date-time' },
          data: { type: 'object', description: 'Event-specific payload' },
        },
      },
      WebhookSubscription: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          url: { type: 'string', format: 'uri' },
          events: { type: 'array', items: { type: 'string' } },
          active: { type: 'boolean' },
          has_secret: { type: 'boolean' },
          metadata: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' } } },
        },
      },
    },
  },
};
