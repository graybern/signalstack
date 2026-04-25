type ConnectionState = 'connecting' | 'connected' | 'disconnected';

interface ConnectionStatusProps {
  state: ConnectionState;
  className?: string;
}

export function ConnectionStatus({ state, className = '' }: ConnectionStatusProps) {
  const colors: Record<ConnectionState, string> = {
    connected: 'bg-emerald-400',
    connecting: 'bg-amber-400',
    disconnected: 'bg-red-400',
  };

  const labels: Record<ConnectionState, string> = {
    connected: 'Live',
    connecting: 'Connecting...',
    disconnected: 'Disconnected',
  };

  return (
    <div className={`inline-flex items-center gap-1.5 text-[11px] text-gray-400 ${className}`}>
      <span className={`w-2 h-2 rounded-full ${colors[state]} ${state === 'connected' ? 'animate-pulse' : ''}`} />
      <span>{labels[state]}</span>
    </div>
  );
}
