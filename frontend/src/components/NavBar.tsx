import { NavLink } from 'react-router-dom';
import { LayoutDashboard, Box, Sprout } from 'lucide-react';

const FONT = '"Hanken Grotesk", system-ui, sans-serif';

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
        height: 48,
        padding: '0 24px',
        gap: 2,
        background: '#0a0b0d',
        borderBottom: '1px solid rgba(199,239,0,0.14)',
      }}
    >
      {/* Brand */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginRight: 20,
          flexShrink: 0,
        }}
      >
        <div
          style={{
            width: 22,
            height: 22,
            background: '#c7ef00',
            borderRadius: 5,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Sprout size={13} color="#1a2200" strokeWidth={2.5} />
        </div>
        <span
          style={{
            fontFamily: FONT,
            fontSize: 15,
            fontWeight: 700,
            color: '#ffffff',
            letterSpacing: '-0.02em',
          }}
        >
          Farm<span style={{ color: '#c7ef00' }}>OS</span>
        </span>
      </div>

      <NavItem to="/" icon={<LayoutDashboard size={13} />} label="Dashboard" end />
      <NavItem to="/3d" icon={<Box size={13} />} label="3D View" />
      <NavItem to="/soil" icon={<Sprout size={13} />} label="Soil Analysis" />
    </nav>
  );
}

function NavItem({
  to,
  icon,
  label,
  end,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  end?: boolean;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      style={({ isActive }) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 14px',
        borderRadius: 6,
        fontFamily: FONT,
        fontSize: 13,
        fontWeight: isActive ? 600 : 400,
        color: isActive ? '#1a2200' : 'rgba(255,255,255,0.55)',
        background: isActive ? '#c7ef00' : 'transparent',
        textDecoration: 'none',
        transition: 'color 0.15s ease, background 0.15s ease',
        cursor: 'pointer',
        letterSpacing: '-0.01em',
      })}
    >
      {icon}
      {label}
    </NavLink>
  );
}
