import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Box, Sprout } from 'lucide-react';

export default function NavBar() {
  return (
    <nav
      data-ui="true"
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        padding: '6px 16px',
        background: 'rgba(10, 11, 13, 0.85)',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
      }}
    >
      <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 10, fontFamily: 'monospace', marginRight: 12, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        FarmOS
      </span>

      <NavItem to="/" icon={<LayoutDashboard size={14} />} label="Dashboard" end />
      <NavItem to="/3d" icon={<Box size={14} />} label="3D Render View" />
      <NavItem to="/soil" icon={<Sprout size={14} />} label="Soil Analysis" />
    </nav>
  );
}

function NavItem({ to, icon, label, end }: { to: string; icon: React.ReactNode; label: string; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 12px',
        borderRadius: 6,
        fontFamily: 'monospace',
        fontSize: 11,
        fontWeight: isActive ? 600 : 400,
        color: isActive ? '#22c55e' : 'rgba(180,200,220,0.7)',
        background: isActive ? 'rgba(34,197,94,0.1)' : 'transparent',
        border: isActive ? '1px solid rgba(34,197,94,0.25)' : '1px solid transparent',
        textDecoration: 'none',
        transition: 'all 0.15s ease',
        cursor: 'pointer',
      })}
    >
      {icon}
      {label}
    </NavLink>
  );
}
