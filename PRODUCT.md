# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A tight-knit friend group (10–15 players) in Singapore who play Singapore/Malaysian Mahjong together regularly. They log every session and care deeply about who is the best player over time. The primary user is also the developer (Brennen).

## Product Purpose

A chess.com-style rating and stats tracker for a private mahjong group. Players log game results after each session; the app computes Elo ratings per pool (ruleset), tracks cumulative chips, and shows who is climbing or falling. Success means every player wants to check their rating after a game.

## Positioning

Private-group mahjong tracker with proper Elo ratings per ruleset pool — not a generic points tally, but a chess-style skill ladder that separates performance across different rule variants (Vanilla, 8 Fei, Guo San, etc.).

## Operating Context

Used on mobile and desktop after mahjong sessions. Someone logs a game (date, 4 players, chips) and the ratings update immediately. Players check their profile and the Ratings page to track their standing. The group plays Singapore/Malaysian Mahjong (not Japanese/Chinese rules).

## Capabilities and Constraints

- Elo ratings per pool (mode-set + tai bounds = one universe)
- Chip tracking: total, avg per game, per wind
- Rank titles: Sparrow → Adept → Tactician → Expert → Master → Grandmaster → Dragon
- Multi-segment session logging (different rulesets in one sitting)
- Pool-scoped leaderboard, player profiles, head-to-head, analytics
- SQLite backend; single-user instance (no auth needed)
- Dark theme only

## Brand Commitments

- Gold accent: #f59e0b (amber-500)
- Dark background: #09090b
- No emojis; lucide-react icons
- The 麻 (mahjong) character as the logo mark
- Name: Mahjong Tracker

## Product Principles

1. Rating first — Elo is the core truth; chips are secondary
2. Pool purity — never mix stats across rulesets
3. Instant clarity — a player should know their standing at a glance
