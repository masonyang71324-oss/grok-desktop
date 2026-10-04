import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { ExternalLink } from 'lucide-react';
import { Spinner } from './components';
import { errorText, request } from './lib';
import { useI18n } from './i18n';
import {
  canPreviewOffice,
  type OfficePreviewModel,
  type PreviewSheet,
} from './office-preview-model';
export { canPreviewOffice };

const noticeKeys: Record<string, string> = {
  'docx-layout': 'DOCX 排版预览包含段落、表格和图片；分页、字体和复杂对象可能与 Word 不同。',
  'embedded-html-omitted': '已省略文档中的嵌入 HTML 内容。',
  'sheet-limitations':
    '只读工作表预览显示文件中已有的格式和公式结果，不会重新计算；图表、条件格式和复杂样式可能未显示。',
  'pptx-limitations':
    '幻灯片仅预览静态文本和图片的位置；母版、组合图形、图表、动画和复杂样式可能未显示。',
  'pptx-unpositioned-text':
    '部分文字使用母版或布局坐标，现显示为文字预览。请用默认程序查看原始位置。',
  'legacy-layout': '此格式仅支持文字预览。使用默认程序查看原始排版。',
  'unsupported-layout': '此文档的排版结构暂不支持，现显示可提取文字。使用默认程序查看完整文档。',
  'preview-truncated':
    '预览已裁剪：每张工作表最多 200 行、40 列，最多 30 张工作表；幻灯片最多 100 页。原文件未更改。',
};
function columnName(index: number) {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}
function SheetView({ sheet }: { sheet: PreviewSheet }) {
  const { t } = useI18n();
  const cells = new Map(sheet.cells.map((cell) => [`${cell.row},${cell.col}`, cell]));
  return (
    <div className="office-sheet-scroll">
      <table className="office-sheet" aria-label={sheet.name}>
        <colgroup>
          <col style={{ width: 46 }} />
          {sheet.columns.map((width, index) => (
            <col key={index} style={{ width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th aria-label={t('单元格坐标')} />
            {sheet.columns.map((_, index) => (
              <th key={index} scope="col">
                {columnName(index + sheet.startCol)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sheet.rows.map((height, index) => {
            const row = index + sheet.startRow;
            return (
              <tr key={row} style={{ height }}>
                <th scope="row">{row + 1}</th>
                {sheet.columns.map((_, colIndex) => {
                  const col = colIndex + sheet.startCol,
                    merge = sheet.merges.find(
                      (m) =>
                        row >= m.startRow &&
                        row <= m.endRow &&
                        col >= m.startCol &&
                        col <= m.endCol,
                    );
                  if (merge && (row !== merge.startRow || col !== merge.startCol)) return null;
                  const cell = cells.get(`${row},${col}`),
                    address = columnName(col) + (row + 1),
                    style = cell?.style;
                  const title = [
                    address,
                    cell?.formula ? `=${cell.formula}` : '',
                    cell?.uncached ? t('公式没有缓存结果，未重新计算') : cell?.format || '',
                  ]
                    .filter(Boolean)
                    .join('\n');
                  return (
                    <td
                      key={col}
                      data-address={address}
                      title={title}
                      rowSpan={merge ? merge.endRow - merge.startRow + 1 : 1}
                      colSpan={merge ? merge.endCol - merge.startCol + 1 : 1}
                      style={{
                        fontWeight: style?.bold ? 'bold' : undefined,
                        fontStyle: style?.italic ? 'italic' : undefined,
                        color: style?.color,
                        backgroundColor: style?.background,
                        fontSize: style?.fontSize ? `${style.fontSize}pt` : undefined,
                        textAlign: style?.align,
                        whiteSpace: style?.wrap ? 'pre-wrap' : 'pre',
                      }}
                    >
                      {cell?.text || ''}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function DocxView({ base64, onError }: { base64: string; onError: (error: string) => void }) {
  const { t } = useI18n();
  const frame = useRef<HTMLIFrameElement>(null);
  const started = useRef('');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    setLoaded(false);
    started.current = '';
  }, [base64]);
  async function render() {
    const element = frame.current,
      doc = element?.contentDocument;
    if (!doc || started.current === base64) return;
    started.current = base64;
    doc.body.replaceChildren();
    const body = doc.createElement('div');
    doc.body.append(body);
    const styles = doc.createElement('div');
    doc.head.append(styles);
    doc.addEventListener('click', (event) => {
      if ((event.target as Element)?.closest?.('a')) event.preventDefault();
    });
    try {
      const { renderAsync } = await import('docx-preview');
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      await renderAsync(bytes.buffer, body, styles, {
        renderAltChunks: false,
        useBase64URL: true,
        ignoreFonts: true,
        renderComments: false,
      });
      if (frame.current === element) setLoaded(true);
    } catch (error) {
      if (frame.current === element) onError(errorText(error));
    }
  }
  return (
    <div className="office-docx-container">
      {!loaded && (
        <div className="office-docx-loading">
          <Spinner />
          {t('正在加载排版预览')}
        </div>
      )}
      <iframe
        ref={frame}
        className="office-docx-frame"
        sandbox="allow-same-origin"
        title={t('DOCX 只读排版预览')}
        srcDoc={
          '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob:; style-src \'unsafe-inline\'; font-src data: blob:;"><style>body{margin:0;background:#e8e9ed;color:#111}a{pointer-events:none}img{max-width:100%}.docx-wrapper{padding:16px!important}section.docx{max-width:100%;box-sizing:border-box}</style></head><body></body></html>'
        }
        onLoad={() => void render()}
      />
    </div>
  );
}
export default function OfficePreview({
  path,
  name,
  onExternal,
}: {
  path: string;
  name?: string;
  onExternal?: () => void;
}) {
  const { t } = useI18n();
  const [model, setModel] = useState<OfficePreviewModel | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(true),
    [sheetIndex, setSheetIndex] = useState(0);
  const [authorization, setAuthorization] = useState(0);
  useEffect(
    () =>
      window.desktop.onEvent?.((event) => {
        if (event.type === 'attachment-authorization-changed' && event.paths.includes(path))
          setAuthorization((value) => value + 1);
      }),
    [path],
  );
  useEffect(() => {
    let active = true;
    setModel(null);
    setError('');
    setBusy(true);
    setSheetIndex(0);
    void request<OfficePreviewModel>('office.preview', { path }, { timeoutMs: 40000 })
      .then((result) => {
        if (active) setModel(result);
      })
      .catch((error) => {
        if (active) setError(errorText(error));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [path, authorization]);
  return (
    <div className="office-preview" aria-label={name || t('Office 只读预览')}>
      <div className="office-preview-toolbar">
        <strong>{t('只读排版预览')}</strong>
        {onExternal && (
          <button className="secondary-button" onClick={onExternal}>
            <ExternalLink size={14} />
            {t('用默认程序打开')}
          </button>
        )}
      </div>
      {busy && (
        <p>
          <Spinner />
          {t('正在加载排版预览')}
        </p>
      )}
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {model?.notices.map((notice) => (
        <p className="preview-notice" key={notice}>
          {t(noticeKeys[notice] || notice)}
        </p>
      ))}
      {model?.kind === 'docx' && <DocxView base64={model.base64} onError={setError} />}
      {model?.kind === 'sheet' && (
        <>
          <div className="office-sheet-tabs" role="tablist">
            {model.sheets.map((sheet, index) => (
              <button
                key={sheet.name}
                role="tab"
                aria-selected={sheetIndex === index}
                onClick={() => setSheetIndex(index)}
              >
                {sheet.name}
              </button>
            ))}
          </div>
          {model.sheets[sheetIndex] && <SheetView sheet={model.sheets[sheetIndex]} />}
        </>
      )}
      {model?.kind === 'pptx' && (
        <div className="office-slides">
          {model.slides.map((slide, index) => (
            <div className="office-slide-section" key={index}>
              <span className="muted">{t('幻灯片 {number}', { number: index + 1 })}</span>
              {(slide.shapes.length > 0 || !slide.unpositionedText) && (
                <div
                  className="office-slide"
                  style={{
                    aspectRatio: `${model.width}/${model.height}`,
                    background: slide.background || '#fff',
                  }}
                >
                  {slide.shapes.map((shape, key) => {
                    const style: CSSProperties = {
                      left: `${shape.x}%`,
                      top: `${shape.y}%`,
                      width: `${shape.width}%`,
                      height: `${shape.height}%`,
                      transform: `rotate(${shape.rotation || 0}deg)`,
                      background: shape.background,
                    };
                    return shape.kind === 'image' ? (
                      <img
                        key={key}
                        className="office-slide-shape"
                        style={style}
                        src={shape.src}
                        alt=""
                      />
                    ) : (
                      <div key={key} className="office-slide-shape office-slide-text" style={style}>
                        {shape.paragraphs?.map((p, pIndex) => (
                          <p key={pIndex} style={{ textAlign: p.align }}>
                            {p.runs.map((run, rIndex) => (
                              <span
                                key={rIndex}
                                style={{
                                  fontSize: `${(run.fontSize / (model.width / 12700)) * 100}cqw`,
                                  fontWeight: run.bold ? 'bold' : undefined,
                                  fontStyle: run.italic ? 'italic' : undefined,
                                  color: run.color,
                                }}
                              >
                                {run.text}
                              </span>
                            ))}
                          </p>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}
              {slide.unpositionedText && (
                <pre className="office-text-preview office-slide-fallback">
                  {slide.unpositionedText}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}
      {model?.kind === 'text' && <pre className="office-text-preview">{model.text}</pre>}
    </div>
  );
}
