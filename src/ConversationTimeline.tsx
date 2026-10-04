import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { flushSync } from 'react-dom';
import { Message } from './components';
import type { TimelineRow } from './timeline.mjs';
import './conversation-window.css';

type ScrollOptions = { block?: ScrollLogicalPosition; offset?: number };
export interface WindowedListHandle {
  scrollToItem(id: string, options?: ScrollOptions): Promise<HTMLElement | null>;
}
export interface ConversationTimelineHandle {
  scrollToRow(id: string, options?: ScrollOptions): Promise<HTMLElement | null>;
}
const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
function indexAt(offsets: number[], offset: number) {
  let low = 0,
    high = offsets.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (offsets[mid] <= offset) low = mid;
    else high = mid - 1;
  }
  return Math.min(low, offsets.length - 2);
}

// The same measured window also works for grouped session-list entries.
export function WindowedList<T extends { id: string }>({
  items,
  scrollRef,
  renderItem,
  estimateHeight = () => 100,
  alwaysRender,
  handleRef,
}: {
  items: T[];
  scrollRef: RefObject<HTMLElement | null>;
  renderItem: (item: T, index: number) => ReactNode;
  estimateHeight?: (item: T) => number;
  alwaysRender?: ReadonlySet<string>;
  handleRef?: Ref<WindowedListHandle>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const nodes = useRef(new Map<string, HTMLDivElement>());
  const heights = useRef(new Map<string, number>());
  const observer = useRef<ResizeObserver | null>(null);
  const [revision, setRevision] = useState(0);
  const [forced, setForced] = useState<string>();
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [selectionBounds, setSelectionBounds] = useState<[number, number]>();
  const bottom = useRef(false);
  const adjustment = useRef(0);
  const layout = useMemo(() => {
    const offsets = [0],
      indices = new Map<string, number>();
    items.forEach((item, index) => {
      indices.set(item.id, index);
      offsets.push(offsets[index] + (heights.current.get(item.id) ?? estimateHeight(item)));
    });
    for (const id of heights.current.keys()) if (!indices.has(id)) heights.current.delete(id);
    return { offsets, indices };
  }, [items, revision, estimateHeight]);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  // A child layout effect can run before its parent's ref is attached.
  useEffect(() => {
    if (scroller !== scrollRef.current) setScroller(scrollRef.current);
  });
  const retainSelection = () => {
    const root = container.current;
    const selection = document.getSelection();
    let bounds: [number, number] | undefined;
    if (
      root &&
      selection &&
      !selection.isCollapsed &&
      selection.rangeCount &&
      (root.contains(selection.anchorNode) || root.contains(selection.focusNode))
    ) {
      const range = selection.getRangeAt(0);
      let first = Infinity,
        last = -1;
      for (const [id, node] of nodes.current) {
        const index = layoutRef.current.indices.get(id);
        if (index !== undefined && node.isConnected && range.intersectsNode(node)) {
          first = Math.min(first, index);
          last = Math.max(last, index);
        }
      }
      if (last >= first) bounds = [first, last];
    }
    setSelectionBounds((previous) =>
      previous?.[0] === bounds?.[0] && previous?.[1] === bounds?.[1] ? previous : bounds,
    );
  };
  const readViewport = () => {
    const scroll = scrollRef.current,
      root = container.current;
    if (!scroll || !root) return;
    const top = Math.max(0, scroll.getBoundingClientRect().top - root.getBoundingClientRect().top);
    setViewport((previous) =>
      Math.abs(previous.top - top) < 1 && previous.height === scroll.clientHeight
        ? previous
        : { top, height: scroll.clientHeight },
    );
  };
  useLayoutEffect(() => {
    const scroll = scroller;
    if (!scroll) return;
    let scheduled = 0;
    const onScroll = () => {
      retainSelection();
      bottom.current = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 40;
      if (!scheduled)
        scheduled = requestAnimationFrame(() => {
          scheduled = 0;
          readViewport();
        });
    };
    let width = scroll.clientWidth;
    const resize = new ResizeObserver(() => {
      if (width !== scroll.clientWidth) {
        width = scroll.clientWidth;
        heights.current.clear();
        setRevision((value) => value + 1);
      }
      readViewport();
    });
    resize.observe(scroll);
    scroll.addEventListener('scroll', onScroll, { passive: true });
    readViewport();
    return () => {
      resize.disconnect();
      scroll.removeEventListener('scroll', onScroll);
      cancelAnimationFrame(scheduled);
    };
  }, [scroller]);
  useEffect(() => {
    if (!scroller) return;
    let pointerInside = false;
    const pointer = (event: PointerEvent) => {
      pointerInside = !!container.current?.contains(event.target as Node);
    };
    const select = () => retainSelection();
    const selectAll = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 'a')
        return;
      const target = event.target as HTMLElement;
      if (target?.closest?.('input, textarea, select') || target?.isContentEditable) return;
      const root = container.current,
        selection = document.getSelection();
      if (
        !root ||
        (!pointerInside &&
          !root.contains(document.activeElement) &&
          !root.contains(selection?.anchorNode || null))
      )
        return;
      event.preventDefault();
      const count = layoutRef.current.offsets.length - 1;
      if (!count || !selection) return;
      flushSync(() => setSelectionBounds([0, count - 1]));
      const range = document.createRange();
      range.selectNodeContents(root);
      selection.removeAllRanges();
      selection.addRange(range);
    };
    document.addEventListener('selectionchange', select);
    document.addEventListener('pointerdown', pointer);
    document.addEventListener('keydown', selectAll);
    return () => {
      document.removeEventListener('selectionchange', select);
      document.removeEventListener('pointerdown', pointer);
      document.removeEventListener('keydown', selectAll);
    };
  }, [scroller]);
  useLayoutEffect(() => {
    observer.current = new ResizeObserver((entries) => {
      const scroll = scrollRef.current,
        root = container.current;
      if (!scroll || !root) return;
      const top = Math.max(
        0,
        scroll.getBoundingClientRect().top - root.getBoundingClientRect().top,
      );
      const current = layoutRef.current;
      const anchor = indexAt(current.offsets, top);
      let changed = false;
      for (const entry of entries) {
        const node = entry.target as HTMLDivElement;
        const id = node.dataset.windowRow!;
        const index = current.indices.get(id);
        const height = node.getBoundingClientRect().height;
        if (index === undefined || height <= 0) continue;
        const previous = current.offsets[index + 1] - current.offsets[index];
        if (Math.abs(previous - height) < 0.5) continue;
        heights.current.set(id, height);
        if (index < anchor) adjustment.current += height - previous;
        changed = true;
      }
      if (changed) setRevision((value) => value + 1);
    });
    for (const node of nodes.current.values()) observer.current.observe(node);
    return () => {
      observer.current?.disconnect();
      observer.current = null;
    };
  }, [scrollRef]);
  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (scroll) {
      if (bottom.current) scroll.scrollTop = scroll.scrollHeight;
      else if (adjustment.current) scroll.scrollTop += adjustment.current;
    }
    adjustment.current = 0;
    readViewport();
  }, [revision]);
  useImperativeHandle(handleRef, () => ({
    async scrollToItem(id, options = {}) {
      if (!layoutRef.current.indices.has(id)) return null;
      bottom.current = false;
      flushSync(() => setForced(id));
      const node = nodes.current.get(id);
      if (!node) return null;
      node.scrollIntoView({ block: options.block || 'center' });
      readViewport();
      await frame();
      await frame();
      if (!node.isConnected) return null;
      node.scrollIntoView({ block: options.block || 'center' });
      if (options.offset && scrollRef.current) scrollRef.current.scrollTop += options.offset;
      readViewport();
      return node;
    },
  }));
  const indices = new Set<number>();
  if (items.length) {
    const first = Math.max(0, indexAt(layout.offsets, Math.max(0, viewport.top - 700)));
    const last = indexAt(layout.offsets, viewport.top + viewport.height + 700);
    for (let index = first; index <= last; index++) indices.add(index);
  }
  for (const id of alwaysRender || []) {
    const index = layout.indices.get(id);
    if (index !== undefined) indices.add(index);
  }
  if (forced && layout.indices.has(forced)) indices.add(layout.indices.get(forced)!);
  if (selectionBounds)
    for (
      let index = selectionBounds[0];
      index <= Math.min(items.length - 1, selectionBounds[1]);
      index++
    )
      indices.add(index);
  const content: ReactNode[] = [];
  let cursor = 0;
  for (const index of [...indices].sort((a, b) => a - b)) {
    if (index > cursor)
      content.push(
        <div
          key={`gap-${cursor}`}
          aria-hidden="true"
          style={{ height: layout.offsets[index] - layout.offsets[cursor] }}
        />,
      );
    const item = items[index];
    content.push(
      <div
        key={item.id}
        className="windowed-list-row"
        data-window-row={item.id}
        ref={(node) => {
          const previous = nodes.current.get(item.id);
          if (previous) observer.current?.unobserve(previous);
          if (node) {
            nodes.current.set(item.id, node);
            observer.current?.observe(node);
          } else nodes.current.delete(item.id);
        }}
      >
        {renderItem(item, index)}
      </div>,
    );
    cursor = index + 1;
  }
  if (cursor < items.length)
    content.push(
      <div
        key={`gap-${cursor}`}
        aria-hidden="true"
        style={{ height: layout.offsets.at(-1)! - layout.offsets[cursor] }}
      />,
    );
  return (
    <div className="windowed-list" ref={container}>
      {content}
    </div>
  );
}

const estimateRow = (row: TimelineRow) =>
  row.kind === 'tool' || row.kind === 'thought' ? 50 : 110 + Math.min(1800, row.text.length / 3);
export default forwardRef<
  ConversationTimelineHandle,
  {
    rows: TimelineRow[];
    scrollRef: RefObject<HTMLElement | null>;
    activeTurnId?: string;
    onRetry: (text: string, attachments?: { name: string; path: string }[]) => void;
    notify: (message: string) => void;
    onOpenFile?: (path: string, line?: number) => void;
  }
>(function ConversationTimeline({ rows, scrollRef, activeTurnId, ...callbacks }, ref) {
  const list = useRef<WindowedListHandle>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const active = useMemo(
    () => new Set(rows.filter((row) => row.turnId === activeTurnId).map((row) => row.id)),
    [rows, activeTurnId],
  );
  useImperativeHandle(ref, () => ({
    async scrollToRow(id, options) {
      const wrapper = await list.current?.scrollToItem(id, options);
      if (!wrapper) return null;
      const node = wrapper.querySelector<HTMLElement>('[data-row-id]');
      if (node instanceof HTMLDetailsElement) {
        flushSync(() => setExpanded((previous) => ({ ...previous, [id]: true })));
        await frame();
        node.scrollIntoView({ block: options?.block || 'center' });
      }
      return node;
    },
  }));
  return (
    <WindowedList
      items={rows}
      scrollRef={scrollRef}
      handleRef={list}
      estimateHeight={estimateRow}
      alwaysRender={active}
      renderItem={(row) => (
        <Message
          row={row}
          {...callbacks}
          expanded={expanded[row.id] ?? (row.kind === 'thought' && row.streaming)}
          onExpandedChange={(open) =>
            setExpanded((previous) =>
              previous[row.id] === open ? previous : { ...previous, [row.id]: open },
            )
          }
        />
      )}
    />
  );
});
