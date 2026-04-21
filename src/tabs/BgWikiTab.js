import React, { useEffect, useRef } from 'react';
import './BgWikiTab.css';

function BgWikiTab() {
  const webviewRef = useRef(null);

  // Route popup/new-window requests out to the user's default browser instead of
  // opening an unsandboxed Electron window.
  useEffect(() => {
    const wv = webviewRef.current;
    if (!wv) return;
    const handler = (e) => {
      if (e.url && /^https?:\/\//i.test(e.url)) {
        e.preventDefault?.();
        if (window.xiAPI?.openExternal) window.xiAPI.openExternal(e.url);
      }
    };
    wv.addEventListener('new-window', handler);
    return () => wv.removeEventListener('new-window', handler);
  }, []);

  return (
    <div className="bgwiki-tab">
      <webview
        ref={webviewRef}
        className="bgwiki-webview"
        src="https://www.bg-wiki.com/ffxi/Main_Page"
        allowpopups="true"
      />
    </div>
  );
}

export default BgWikiTab;
