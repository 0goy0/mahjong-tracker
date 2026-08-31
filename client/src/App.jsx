import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import History from './pages/History';
import LogGame from './pages/LogGame';
import Players from './pages/Players';
import PlayerDetail from './pages/PlayerDetail';
import Analytics from './pages/Analytics';
import HeadToHead from './pages/HeadToHead';
import Ratings from './pages/Ratings';
import Data from './pages/Data';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="history" element={<History />} />
        <Route path="dashboard" element={<Navigate to="/" replace />} />
        <Route path="log" element={<LogGame />} />
        <Route path="log/:id" element={<LogGame />} />
        <Route path="players" element={<Players />} />
        <Route path="players/:id" element={<PlayerDetail />} />
        <Route path="ratings" element={<Ratings />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="h2h" element={<HeadToHead />} />
        <Route path="data" element={<Data />} />
      </Route>
    </Routes>
  );
}
