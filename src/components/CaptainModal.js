import React from 'react';
import Modal from './Modal';
import './CaptainModal.css';

const SAFE_ADDONS = [
  { name: 'PacketLogger', desc: 'Captures all received/emitted packets by ID and direction. Compatible with PVLV/VieweD.' },
  { name: 'PacketBridge', desc: 'Re-emits all received/emitted packets to a configurable UDP port.' },
  { name: 'CapLog', desc: 'Captures chat log content. Strips auto-translate tags and colors.' },
  { name: 'NPCLogger', desc: 'Captures NPC entity packet data — position, model, level.' },
  { name: 'EventView', desc: 'Captures all event packets including event number, parameters, music, animations.' },
  { name: 'HPTrack', desc: 'Logs HP deducted from defeated enemies. Includes enspells, skillchains, spikes.' },
  { name: 'KITrack', desc: 'Logs obtained/lost key items with position and zone.' },
  { name: 'PathLog', desc: 'Tracks and captures player and NPC/mob movement paths.' },
  { name: 'AttackDelay', desc: 'Summarises melee attack delay from enemy action packets.' },
  { name: 'ShopStock', desc: 'Captures items sold by NPCs. Auto-appraise is opt-in (☠️ when enabled).' },
  { name: 'GuildStock', desc: 'Captures items sold and purchased by Guild Shops.' },
  { name: 'WeatherTrack', desc: 'Captures weather on zone-in and subsequent weather events.' },
  { name: 'OBS', desc: 'Automates OBS recording via WebSocket. Sets source to the current FFXI window.' },
  { name: 'FishMon', desc: 'Tracks fishing catches.' },
];

const CAUTION_ADDONS = [
  { name: 'Widescan', risk: '☠️', desc: 'Emits recurring Widescan packets. Enabled by default. Required by LevelRangeTrack.' },
  { name: 'LevelRangeTrack', risk: '☠️', desc: 'Captures level ranges per unique mob. Requires Widescan.' },
  { name: 'CheckParam', risk: '☠️☠️', desc: 'Logs /checkparam results at a defined interval. Intervals below 1s are high risk.' },
  { name: 'SpawnTrack', risk: '☠️☠️☠️', desc: 'Tracks exact spawn times and spawn points for defeated mobs. Must accept warning in settings.' },
  { name: 'ZoneDump', risk: '☠️☠️☠️', desc: 'Queries server for all static entities in zone. Must accept warning in settings.' },
];

function CaptainModal({ onClose }) {
  return (
    <Modal onClose={onClose} ariaLabel="Captain Sub-addons">
      <div className="captain-modal panel">
        <div className="captain-modal-header">
          <h3 className="cinzel captain-modal-title">👨‍✈️ Captain — Sub-addons</h3>
          <button className="btn btn-ghost btn-sm" aria-label="Close" onClick={onClose}>✕</button>
        </div>
        <div className="captain-modal-banner">
          Sub-addons are configured in-game via <code>/cap</code>. Use this reference to understand what each one does before enabling.
        </div>

        <div className="captain-modal-section-title cinzel">Safe</div>
        <div className="captain-modal-grid">
          {SAFE_ADDONS.map(a => (
            <div key={a.name} className="captain-addon-card">
              <span className="captain-addon-name mono">{a.name}</span>
              <p className="captain-addon-desc">{a.desc}</p>
            </div>
          ))}
        </div>

        <div className="captain-modal-section-title cinzel captain-section-caution">Use with caution</div>
        <div className="captain-modal-grid">
          {CAUTION_ADDONS.map(a => (
            <div key={a.name} className="captain-addon-card captain-addon-caution">
              <div className="captain-addon-card-header">
                <span className="captain-addon-name mono">{a.name}</span>
                <span className="captain-risk-badge">{a.risk}</span>
              </div>
              <p className="captain-addon-desc">{a.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}

export default CaptainModal;
