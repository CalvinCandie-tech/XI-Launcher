import React from 'react';
import './BgWikiTab.css';

function BgWikiTab() {
  return (
    <div className="bgwiki-tab">
      <webview
        className="bgwiki-webview"
        src="https://www.bg-wiki.com/ffxi/Main_Page"
        allowpopups="true"
      />
    </div>
  );
}

export default BgWikiTab;
