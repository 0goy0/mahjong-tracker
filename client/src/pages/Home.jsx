import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { PlusCircle, Trophy, ClipboardList, BarChart2 } from 'lucide-react';
import { api } from '../api';
import { usePool } from '../PoolContext';
import { getRank } from '../labels';

const C = {
  card: '#ffffff', border: '#e5e4e0',
  bg: '#fafaf8', bgSubtle: '#f5f5f2',
  text: '#0a0a0a', textSec: '#374151', textMuted: '#6b7280', textFaint: '#9ca3af',
  win: '#15803d', loss: '#dc2626',
};

function initials(name) {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

function chipColor(v) { return v > 0 ? C.win : v < 0 ? C.loss : C.textMuted; }
function signed(v) { return (v > 0 ? '+' : '') + v; }

const PLACE_EMOJIS = ['🥇', '🥈', '🥉', '4️⃣'];
const MODE_LABELS = { vanilla: 'Vanilla', guo_san: 'Guo San', '8_fei': '8 Fei', '4_fei': '4 Fei', '12_fei': '12 Fei' };

function PodiumSlot({ player, place, isCenter }) {
  const rank = getRank(player.rating);
  const placeEmoji = ['', '🥇', '🥈', '🥉'][place];
  const podiumColors = { 1: '#f59e0b', 2: '#9ca3af', 3: '#cd7f32' };
  const podiumH = { 1: 72, 2: 52, 3: 40 };

  return (
    <div className="flex flex-col items-center gap-2" style={{ flex: 1, minWidth: 0 }}>
      <div className="relative">
        {player.avatar ? (
          <img src={player.avatar} alt={player.name}
            className="w-14 h-14 rounded-full object-cover"
            style={{
              boxShadow: isCenter ? `0 0 24px ${player.color}88` : 'none',
              border: isCenter ? `2px solid ${player.color}` : `2px solid ${player.color}44`,
            }} />
        ) : (
          <div className="w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold"
            style={{
              background: player.color,
              color: '#0a0a0a',
              boxShadow: isCenter ? `0 0 24px ${player.color}88` : 'none',
              border: isCenter ? `2px solid ${player.color}` : 'none',
            }}>
            {initials(player.name)}
          </div>
        )}
        <span className="absolute -top-1 -right-2 text-lg leading-none">{placeEmoji}</span>
      </div>

      <div className="text-center w-full px-1 min-w-0">
        <div className="font-semibold text-sm truncate" style={{ color: C.text }}>{player.name}</div>
        {rank && (
          <div className="text-xs font-medium truncate" style={{ color: rank.color }}>
            {rank.chinese} {rank.title}
          </div>
        )}
        <div className="font-bold tabular-nums mt-0.5" style={{ fontSize: isCenter ? 22 : 17, color: isCenter ? '#f59e0b' : C.text }}>
          {Math.round(player.rating)}
        </div>
        {player.last_delta != null && (
          <div className="text-xs font-semibold" style={{ color: player.last_delta >= 0 ? C.win : C.loss }}>
            {player.last_delta >= 0 ? '+' : ''}{Math.round(player.last_delta)}
          </div>
        )}
      </div>

      <div className="w-full rounded-t-xl flex items-center justify-center font-bold text-lg"
        style={{ height: podiumH[place], background: podiumColors[place] + (isCenter ? 'cc' : '66') }}>
        {place}
      </div>
    </div>
  );
}

function Podium({ top3 }) {
  const [second, first, third] = [top3[1], top3[0], top3[2]];
  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: C.card, borderColor: C.border }}>
      <div className="flex items-center gap-2 px-5 py-3.5 border-b" style={{ borderColor: C.border, background: C.bgSubtle }}>
        <Trophy size={15} color="#f59e0b" />
        <span className="font-semibold text-sm" style={{ color: C.text }}>Current Standings</span>
        <Link to="/ratings" className="ml-auto text-xs font-medium" style={{ color: '#f59e0b' }}>See all →</Link>
      </div>
      <div className="px-4 pt-6 pb-0 flex items-end gap-2">
        {second && <PodiumSlot player={second} place={2} isCenter={false} />}
        {first && <PodiumSlot player={first} place={1} isCenter={true} />}
        {third && <PodiumSlot player={third} place={3} isCenter={false} />}
      </div>
    </div>
  );
}

function LastGameCard({ game }) {
  const modes = Array.isArray(game.modes) ? game.modes : [];
  const modeStr = modes.map(m => MODE_LABELS[m] || m).join(' + ');
  const sorted = [...(game.seats || [])].sort((a, b) => b.chips - a.chips);

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ background: C.card, borderColor: C.border }}>
      <div className="px-5 py-3.5 border-b flex items-center justify-between gap-2"
        style={{ borderColor: C.border, background: C.bgSubtle }}>
        <span className="font-semibold text-sm" style={{ color: C.text }}>Last Game</span>
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0"
            style={{ background: '#f59e0b22', color: '#92400e' }}>{modeStr}</span>
          <span className="text-xs flex-shrink-0" style={{ color: C.textMuted }}>
            {game.rounds} winds · {game.date}
          </span>
        </div>
      </div>
      <div>
        {sorted.map((seat, i) => (
          <div key={seat.player_id}
            className="px-5 py-3 flex items-center gap-3 border-b last:border-0"
            style={{ borderColor: C.border, background: i === 0 ? '#fefce8' : 'transparent' }}>
            <span className="text-lg w-7 flex-shrink-0">{PLACE_EMOJIS[i]}</span>
            <span className="flex-1 font-medium text-sm truncate" style={{ color: C.text }}>
              {seat.player_name}
            </span>
            {seat.elo_delta != null && (
              <span className="text-xs font-medium tabular-nums flex-shrink-0"
                style={{ color: seat.elo_delta >= 0 ? C.win : C.loss }}>
                {seat.elo_delta >= 0 ? '+' : ''}{seat.elo_delta} ELO
              </span>
            )}
            <span className="font-bold text-sm tabular-nums flex-shrink-0"
              style={{ color: chipColor(seat.chips), minWidth: 52, textAlign: 'right' }}>
              {signed(seat.chips)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const { pool } = usePool();
  const [top3, setTop3] = useState([]);
  const [lastGame, setLastGame] = useState(null);
  const [counts, setCounts] = useState({ games: 0, players: 0 });

  useEffect(() => {
    Promise.all([
      api.getPlayers(),
      pool ? api.getEloLeaderboard(pool) : Promise.resolve([]),
      api.getGames(pool),
    ]).then(([players, elo, games]) => {
      const p = Array.isArray(players) ? players : [];
      const e = Array.isArray(elo) ? elo : [];
      const g = Array.isArray(games) ? games : [];
      const playerMap = Object.fromEntries(p.map(pl => [pl.id, pl]));
      const enriched = e.map(row => ({ ...row, avatar: playerMap[row.player_id]?.avatar || null }));
      setTop3(enriched.slice(0, 3));
      setCounts({ games: g.length, players: p.length });
      setLastGame(g[0] || null);
    });
  }, [pool]);

  const noData = !top3.length && !lastGame;

  return (
    <div className="max-w-xl mx-auto space-y-5">
      {/* Header */}
      <div className="text-center pt-2 pb-1">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-bold mx-auto mb-3"
          style={{ background: '#f59e0b', color: '#0a0a0a', boxShadow: '0 0 28px #f59e0b55' }}>
          麻
        </div>
        <h1 className="text-2xl font-bold tracking-tight" style={{ color: C.text }}>Mahjong Tracker</h1>
        <div className="flex items-center justify-center gap-3 mt-2">
          <span className="text-sm" style={{ color: C.textMuted }}>
            <strong style={{ color: C.text }}>{counts.games}</strong> games
          </span>
          <span style={{ color: C.border }}>·</span>
          <span className="text-sm" style={{ color: C.textMuted }}>
            <strong style={{ color: C.text }}>{counts.players}</strong> players
          </span>
        </div>
      </div>

      {noData ? (
        <div className="rounded-2xl border p-12 text-center" style={{ background: C.card, borderColor: C.border }}>
          <div className="text-5xl mb-4">🀄</div>
          <p className="font-semibold text-lg" style={{ color: C.text }}>No games yet</p>
          <p className="text-sm mt-1 mb-6" style={{ color: C.textMuted }}>Log your first game to get started.</p>
          <Link to="/log"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-semibold text-sm"
            style={{ background: '#f59e0b', color: '#0a0a0a' }}>
            <PlusCircle size={16} /> Log a Game
          </Link>
        </div>
      ) : (
        <>
          {top3.length > 0 && <Podium top3={top3} />}
          {lastGame && <LastGameCard game={lastGame} />}
        </>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        {[
          { to: '/log', icon: PlusCircle, label: 'Log Game', desc: 'Record a session', bg: '#fffbeb', accent: '#f59e0b', iconBg: '#f59e0b', iconColor: '#0a0a0a' },
          { to: '/ratings', icon: Trophy, label: 'Ratings', desc: 'Full leaderboard', bg: C.card, accent: C.border, iconBg: '#a855f718', iconColor: '#a855f7' },
          { to: '/history', icon: ClipboardList, label: 'History', desc: 'All games', bg: C.card, accent: C.border, iconBg: '#3b82f618', iconColor: '#3b82f6' },
          { to: '/analytics', icon: BarChart2, label: 'Analytics', desc: 'Stats & trends', bg: C.card, accent: C.border, iconBg: '#22c55e18', iconColor: '#22c55e' },
        ].map(({ to, icon: Icon, label, desc, bg, accent, iconBg, iconColor }) => (
          <Link key={to} to={to}
            className="rounded-2xl border p-4 flex items-center gap-3 transition-all hover:shadow-sm"
            style={{ background: bg, borderColor: accent }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: iconBg }}>
              <Icon size={18} color={iconColor} />
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-sm truncate" style={{ color: C.text }}>{label}</div>
              <div className="text-xs truncate" style={{ color: C.textMuted }}>{desc}</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
