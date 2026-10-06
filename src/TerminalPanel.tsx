import { useEffect, useRef, useState } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import './desktop-tools.css';
import { Modal } from './components';
import { request, errorText } from './lib';
import { useI18n } from './i18n';
type State = {
  id: string;
  cwd: string;
  status: string;
  log: string;
  sequence: number;
  exitCode?: number;
};
function terminalTheme(): ITheme {
  if (document.documentElement.dataset.theme !== 'light')
    return { background: '#111517', foreground: '#e2e8ed' };
  return {
    background: '#ffffff',
    foreground: '#202625',
    cursor: '#18764b',
    cursorAccent: '#ffffff',
    selectionBackground: '#cfe5d8',
    selectionForeground: '#202625',
    black: '#242929',
    red: '#a32627',
    green: '#18764b',
    yellow: '#805900',
    blue: '#245d99',
    magenta: '#7845a9',
    cyan: '#176778',
    white: '#606968',
    brightBlack: '#626a69',
    brightRed: '#b32f34',
    brightGreen: '#247347',
    brightYellow: '#856000',
    brightBlue: '#286aa7',
    brightMagenta: '#8750a4',
    brightCyan: '#20717d',
    brightWhite: '#353d3a',
  };
}
export default function TerminalPanel({ cwd, onClose }: { cwd: string; onClose: () => void }) {
  const { t } = useI18n();
  const host = useRef<HTMLDivElement>(null),
    terminalRef = useRef<Terminal | null>(null),
    stateRef = useRef<State | null>(null);
  const [state, setState] = useState<State | null>(null),
    [error, setError] = useState(''),
    [generation, setGeneration] = useState(0),
    [working, setWorking] = useState(false);
  useEffect(() => {
    let live = true,
      ready = false;
    const queued: any[] = [];
    stateRef.current = null;
    setState(null);
    setError('');
    const terminal = new Terminal({
      convertEol: false,
      cursorBlink: true,
      fontFamily: 'Cascadia Mono, Consolas, monospace',
      fontSize: 13,
      scrollback: 4000,
      theme: terminalTheme(),
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host.current!);
    terminalRef.current = terminal;
    const themeObserver = new MutationObserver(() => {
      terminal.options.theme = terminalTheme();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });
    const resize = () => {
      try {
        fit.fit();
        const entry = stateRef.current;
        if (entry?.status === 'running')
          void request('terminal.resize', {
            id: entry.id,
            cols: terminal.cols,
            rows: terminal.rows,
          }).catch(() => {});
      } catch {}
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host.current!);
    fit.fit();
    function receive(event: any) {
      const entry = stateRef.current;
      if (!entry) return;
      if (
        event.type === 'terminal-data' &&
        event.id === entry.id &&
        event.sequence > entry.sequence
      ) {
        entry.sequence = event.sequence;
        terminal.write(event.data);
      }
      if (event.type === 'terminal-exit' && event.state.id === entry.id) {
        stateRef.current = event.state;
        setState(event.state);
      }
    }
    const unsubscribe = window.desktop.onEvent((event) => {
      if (!ready) queued.push(event);
      else receive(event);
    });
    const input = terminal.onData((data) => {
      const entry = stateRef.current;
      if (entry?.status === 'running')
        void request('terminal.input', { id: entry.id, data }).catch((e) => {
          if (live) setError(errorText(e));
        });
    });
    void request<State>('terminal.open', {
      cwd,
      cols: terminal.cols,
      rows: terminal.rows,
      restart: generation > 0,
    })
      .then((entry) => {
        if (!live) return;
        stateRef.current = entry;
        setState(entry);
        terminal.write(entry.log);
        ready = true;
        queued.forEach(receive);
        resize();
        terminal.focus();
      })
      .catch((e) => {
        if (live) setError(errorText(e));
      });
    return () => {
      live = false;
      unsubscribe();
      observer.disconnect();
      themeObserver.disconnect();
      input.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [cwd, generation]);
  async function stop() {
    if (!state) return;
    setWorking(true);
    try {
      const next = await request<State>('terminal.close', { id: state.id });
      stateRef.current = next;
      setState(next);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setWorking(false);
    }
  }
  return (
    <Modal title={t('交互终端')} subtitle={cwd} onClose={onClose} wide>
      <div className="desktop-tool-actions">
        <button
          className="secondary-button"
          onClick={() =>
            void request('system.open', { target: 'terminal', cwd }).catch((error) =>
              setError(errorText(error)),
            )
          }
        >
          {t('在项目终端中打开')}
        </button>
        <span className="muted">{t('关闭面板后终端继续运行；停止会结束该终端。')}</span>
        <button
          className="secondary-button"
          disabled={!state || state.status !== 'running' || working}
          onClick={() => void stop()}
        >
          {t('停止终端')}
        </button>
        <button
          className="secondary-button"
          disabled={state?.status === 'running' || working}
          onClick={() => setGeneration((n) => n + 1)}
        >
          {t('重新启动')}
        </button>
      </div>
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <div ref={host} className="interactive-terminal" aria-label={t('PowerShell 交互终端')} />
      {state?.status === 'exited' && (
        <p role="status">{t('终端已退出，代码 {code}', { code: state.exitCode ?? 0 })}</p>
      )}
    </Modal>
  );
}
