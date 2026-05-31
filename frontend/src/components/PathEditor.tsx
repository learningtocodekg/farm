import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import type { Waypoint, CaptureResult, ViewName } from './DroneScanner';

export interface PathEditorProps {
  waypoints: Waypoint[];
  altitude: number;
  xOffset: number;
  captureWidth: number;
  obliqueAngle: number;
  obliqueHeight: number;
  previewResult: CaptureResult | null;
  selectedIndex: number | null;
  onAltitudeChange: (v: number) => void;
  onXOffsetChange: (v: number) => void;
  onObliqueAngleChange: (v: number) => void;
  onObliqueHeightChange: (v: number) => void;
  onSelectWaypoint: (index: number) => void;
  onDeleteWaypoint: (index: number) => void;
  onDeleteRow: (row: number) => void;
}

const ROW_COLORS = [
  '#ff4d4d','#ff944d','#ffd24d','#8fff4d',
  '#4dffc8','#4db0ff','#984dff','#ff4dbe',
];

const OBLIQUE_VIEWS: ViewName[] = ['north', 'south', 'east', 'west'];

export function PathEditor({
  waypoints,
  altitude,
  xOffset,
  obliqueAngle,
  obliqueHeight,
  previewResult,
  selectedIndex,
  onAltitudeChange,
  onXOffsetChange,
  onObliqueAngleChange,
  onObliqueHeightChange,
  onSelectWaypoint,
  onDeleteWaypoint,
  onDeleteRow,
}: PathEditorProps) {

  const rows = useMemo(() => {
    const map = new Map<number, { wp: Waypoint; idx: number }[]>();
    waypoints.forEach((wp, idx) => {
      if (!map.has(wp.row)) map.set(wp.row, []);
      map.get(wp.row)!.push({ wp, idx });
    });
    return Array.from(map.entries()).sort(([a], [b]) => a - b);
  }, [waypoints]);

  const selectedWp = selectedIndex !== null ? waypoints[selectedIndex] : null;

  const panel = (
    <div
      style={{
        position: 'fixed', top: 16, left: 16, zIndex: 9300,
        width: 300, maxHeight: 'calc(100vh - 32px)',
        display: 'flex', flexDirection: 'column',
        background: 'rgba(6,8,14,0.94)',
        border: '1px solid rgba(255,255,255,0.10)',
        borderRadius: 10,
        fontFamily: '"Courier New", Courier, monospace',
        fontSize: 11, color: '#ccd',
        pointerEvents: 'all',
        boxShadow: '0 4px 32px rgba(0,0,0,0.6)',
        overflow: 'hidden',
      }}
    >
      {/* ── Header ── */}
      <div style={{ padding: '10px 14px 8px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        <div style={{ color: '#44ff99', letterSpacing: 2, fontSize: 9, marginBottom: 10 }}>
          ◈ PATH EDITOR
        </div>

        {/* Altitude slider */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 10 }}>
            <span style={{ color: '#8899aa' }}>ALTITUDE</span>
            <span style={{ color: '#44ccff', fontWeight: 700 }}>{altitude.toFixed(1)} m</span>
          </div>
          <input type="range" min={0.5} max={20} step={0.1} value={altitude}
            onChange={(e) => onAltitudeChange(parseFloat(e.target.value))}
            style={{ width: '100%', accentColor: '#44ccff', cursor: 'pointer' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#445566', marginTop: 2 }}>
            <span>0.5 m</span><span>20 m</span>
          </div>
        </div>

        {/* X position slider */}
        <div style={{ marginBottom: 4 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 10 }}>
            <span style={{ color: '#8899aa' }}>X POSITION</span>
            <span style={{ color: '#ffcc44', fontWeight: 700 }}>{xOffset.toFixed(2)} m</span>
          </div>
          <input type="range" min={-5} max={5} step={0.05} value={xOffset}
            onChange={(e) => onXOffsetChange(parseFloat(e.target.value))}
            style={{ width: '100%', accentColor: '#ffcc44', cursor: 'pointer' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 8, color: '#445566', marginTop: 2 }}>
            <span>−5 m</span><span>0</span><span>+5 m</span>
          </div>
        </div>
      </div>

      {/* ── Waypoint list ── */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 0' }}>
        {rows.length === 0 && (
          <div style={{ padding: '16px 14px', color: '#445566', textAlign: 'center' }}>
            No waypoints
          </div>
        )}
        {rows.map(([rowNum, entries]) => {
          const color = ROW_COLORS[rowNum % ROW_COLORS.length];
          return (
            <div key={rowNum} style={{ marginBottom: 4 }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'4px 14px', background:'rgba(255,255,255,0.04)' }}>
                <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                  <span style={{ display:'inline-block', width:8, height:8, borderRadius:'50%', background:color, flexShrink:0 }} />
                  <span style={{ color:'#aabbcc', fontWeight:700, fontSize:10 }}>ROW {rowNum}</span>
                  <span style={{ color:'#445566', fontSize:9 }}>({entries.length} pts)</span>
                </div>
                <button onClick={() => onDeleteRow(rowNum)} style={deleteBtn('#7a1515')}>✕ row</button>
              </div>
              {entries.map(({ wp, idx }) => {
                const isSel = idx === selectedIndex;
                return (
                  <div key={idx}
                    style={{ display:'flex', alignItems:'center', gap:6, padding:'3px 14px 3px 22px', background:isSel?'rgba(68,204,255,0.08)':'transparent', borderLeft:isSel?'2px solid #44ccff':'2px solid transparent', cursor:'pointer' }}
                    onClick={() => onSelectWaypoint(idx)}
                  >
                    <span style={{ color:'#445566', fontSize:9, minWidth:36 }}>c{wp.col}</span>
                    <span style={{ color:'#667788', fontSize:9, flex:1 }}>({wp.x.toFixed(1)}, {wp.z.toFixed(1)})</span>
                    <button onClick={(e) => { e.stopPropagation(); onSelectWaypoint(idx); }} style={{ ...iconBtn, color:isSel?'#44ccff':'#556677' }}>👁</button>
                    <button onClick={(e) => { e.stopPropagation(); onDeleteWaypoint(idx); }} style={{ ...iconBtn, color:'#884444' }}>✕</button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* ── Oblique views + controls ── */}
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', padding: '10px 14px' }}>
        <div style={{ fontSize: 9, color: '#8899aa', letterSpacing: 1, marginBottom: 8 }}>
          {selectedWp
            ? `OBLIQUE VIEWS · r${selectedWp.row}c${selectedWp.col} · (${selectedWp.x.toFixed(1)}, ${selectedWp.z.toFixed(1)})`
            : 'OBLIQUE VIEWS · click a waypoint'}
        </div>

        {/* 4 oblique previews in one row */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
          {OBLIQUE_VIEWS.map((v) => (
            <div key={v} style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                position: 'relative',
                height: 64,
                background: '#080a10',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 4,
                overflow: 'hidden',
              }}>
                {previewResult ? (
                  <img
                    src={previewResult.views[v].imageDataUrl}
                    alt={v}
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'100%' }}>
                    <span style={{ color:'#223344', fontSize:8 }}>—</span>
                  </div>
                )}
                {/* Compass label */}
                <span style={{
                  position:'absolute', top:2, left:3,
                  fontSize:7, fontWeight:700, color:'#44ccff',
                  textShadow:'0 1px 2px rgba(0,0,0,0.9)',
                  letterSpacing:0.5,
                }}>
                  {v[0].toUpperCase()}
                </span>
              </div>
              <div style={{ textAlign:'center', fontSize:7, color:'#445566', marginTop:2 }}>{v}</div>
            </div>
          ))}
        </div>

        {/* Oblique angle slider */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4, fontSize:10 }}>
            <span style={{ color:'#8899aa' }}>ANGLE</span>
            <span style={{ color:'#ff8844', fontWeight:700 }}>{obliqueAngle.toFixed(0)}°</span>
          </div>
          <input type="range" min={10} max={80} step={1} value={obliqueAngle}
            onChange={(e) => onObliqueAngleChange(parseFloat(e.target.value))}
            style={{ width:'100%', accentColor:'#ff8844', cursor:'pointer' }}
          />
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:8, color:'#445566', marginTop:2 }}>
            <span>10° shallow</span><span>80° steep</span>
          </div>
        </div>

        {/* Oblique height slider */}
        <div>
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:4, fontSize:10 }}>
            <span style={{ color:'#8899aa' }}>HEIGHT</span>
            <span style={{ color:'#ff8844', fontWeight:700 }}>{obliqueHeight.toFixed(1)} m</span>
          </div>
          <input type="range" min={0.1} max={3} step={0.05} value={obliqueHeight}
            onChange={(e) => onObliqueHeightChange(parseFloat(e.target.value))}
            style={{ width:'100%', accentColor:'#ff8844', cursor:'pointer' }}
          />
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:8, color:'#445566', marginTop:2 }}>
            <span>0.1 m</span><span>3 m</span>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(panel, document.body);
}

function deleteBtn(bg: string): React.CSSProperties {
  return { background:bg, border:'1px solid rgba(255,255,255,0.10)', borderRadius:4, color:'#ffaaaa', cursor:'pointer', fontFamily:'"Courier New",Courier,monospace', fontSize:9, fontWeight:700, letterSpacing:0.5, padding:'2px 7px', whiteSpace:'nowrap' };
}

const iconBtn: React.CSSProperties = { background:'none', border:'none', cursor:'pointer', fontSize:11, padding:'0 2px', lineHeight:1 };
