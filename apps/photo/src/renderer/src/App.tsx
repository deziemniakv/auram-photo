import { useEffect, useState } from 'react';
import { Button, ErrorState, LoadingState, ToastViewport } from '@auram/ui';
import { Canvas } from './components/Canvas';
import { ColorPanel } from './components/ColorPanel';
import { Dialogs } from './components/Dialogs';
import { LayersPanel } from './components/LayersPanel';
import { MenuBar } from './components/MenuBar';
import { OptionsBar } from './components/OptionsBar';
import { StartScreen } from './components/StartScreen';
import { StatusBar } from './components/StatusBar';
import { Toolbar } from './components/Toolbar';
import { BrandMark } from './components/BrandMark';
import { guardUnsaved, openFile, publishDocumentState } from './editor/actions';
import { handleShortcut } from './editor/commands';
import { dismissToast, useEditor } from './editor/store';
import { dictionaries, useT } from './i18n';
import { call, getApi, messageOf } from './lib/api';
import panels from './components/Panels.module.css';
import styles from './App.module.css';

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

export function App() {
  const t = useT();
  const session = useEditor((s) => s.session);
  const edited = useEditor((s) => s.edited);
  const toasts = useEditor((s) => s.toasts);
  const [status, setStatus] = useState<'loading' | 'ready' | { error: string }>(() =>
    window.auramPhoto ? 'loading' : { error: dictionaries.en.errors.bridgeMissing },
  );

  useEffect(() => {
    if (!window.auramPhoto) return;
    const api = getApi();
    let disposed = false;
    const offs = [
      api.files.onOpenFile((file) => void openFile(file)),
      api.window.onCloseRequested(() => {
        void guardUnsaved().then((ok) => ok && call((a) => a.window.confirmClose()));
      }),
    ];
    (async () => {
      const info = await call((a) => a.app.info());
      useEditor.setState({ info });
      document.documentElement.lang = info.language;
      document.documentElement.dataset.platform = info.platform;
      publishDocumentState();
      if (!disposed) setStatus('ready');
      const initial = await call((a) => a.files.initial());
      if (initial) await openFile(initial, true);
    })().catch((error: unknown) => !disposed && setStatus({ error: messageOf(error) }));
    return () => {
      disposed = true;
      offs.forEach((off) => off());
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTyping(event.target) && !(event.ctrlKey || event.metaKey)) return;
      if (handleShortcut(event)) event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => publishDocumentState(), [edited, session]);

  if (status === 'loading') {
    return (
      <div className={styles.boot}>
        <LoadingState label={t.common.loading} />
      </div>
    );
  }
  if (typeof status === 'object') {
    return (
      <div className={styles.boot}>
        <ErrorState
          title={t.errors.startupFailed}
          actions={<Button onClick={() => window.location.reload()}>OK</Button>}
        >
          {status.error}
        </ErrorState>
      </div>
    );
  }

  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <div className={styles.brand}>
          <BrandMark height={20} />
          <span className={styles.wordmark}>Auram</span>
          <span className={styles.product}>Photo</span>
        </div>
        <MenuBar />
        <div className={styles.title}>
          {session ? `${session.file.name}${edited ? ' •' : ''}` : ''}
        </div>
      </header>
      {session ? (
        <>
          <OptionsBar />
          <main className={styles.workspace}>
            <Toolbar />
            <Canvas key={session.id} session={session} />
            <aside className={panels.panels}>
              <ColorPanel />
              <LayersPanel session={session} />
            </aside>
          </main>
        </>
      ) : (
        <main className={styles.empty}>
          <StartScreen />
        </main>
      )}
      <StatusBar />
      <Dialogs />
      <ToastViewport toasts={toasts} onDismiss={dismissToast} dismissLabel={t.common.dismiss} />
    </div>
  );
}
