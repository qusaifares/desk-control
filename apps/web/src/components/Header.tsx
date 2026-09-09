import { useEffect, useState } from 'react';
import { Button, IconButton } from '../design/index.js';
import { GearIcon } from './icons.js';

/** Local clock. Never from the controller: the panel must read right offline. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function Header({
  name,
  onOpenSystem,
  editing,
  onToggleEdit,
}: {
  name: string;
  onOpenSystem: () => void;
  editing?: boolean;
  onToggleEdit?: () => void;
}) {
  const now = useNow();
  const date = now.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
  const time = now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  return (
    <header className="desk-header">
      <div>
        <h1 className="desk-brand-title">{name}</h1>
        <div className="desk-brand-sub">Focus anywhere</div>
      </div>
      <div className="desk-header-right">
        <div className="desk-clock">
          <div className="desk-clock-date">{date}</div>
          <div className="desk-clock-time">{time}</div>
        </div>
        {onToggleEdit ? (
          <Button variant={editing ? 'primary' : 'default'} onClick={onToggleEdit}>
            {editing ? 'Done' : 'Edit desk'}
          </Button>
        ) : null}
        <IconButton label="System details" onClick={onOpenSystem}>
          <GearIcon />
        </IconButton>
      </div>
    </header>
  );
}
