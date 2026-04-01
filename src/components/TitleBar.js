import React from 'react';
import './TitleBar.css';

const api = window.xiAPI;

function TitleBar() {
  return (
    <div className="titlebar">
      <div className="titlebar-accent" />
      <div className="titlebar-left">
        <img className="titlebar-crystal-img" src="./crystal.svg" alt="" />
        <span className="titlebar-title">XI LAUNCHER</span>
      </div>
      <div className="titlebar-controls">
        <button className="tb-btn tb-minimize" onClick={() => api?.minimize()}>─</button>
        <button className="tb-btn tb-maximize" onClick={() => api?.maximize()}>□</button>
        <button className="tb-btn tb-close" onClick={() => api?.close()}>✕</button>
      </div>
    </div>
  );
}

export default TitleBar;
