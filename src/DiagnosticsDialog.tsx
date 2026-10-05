import { useEffect, useRef, useState } from 'react';
import { Download, RefreshCw } from 'lucide-react';
import { Modal, Spinner } from './components';
import SystemErrorDetails from './SystemErrorDetails';
import { errorText, request } from './lib';
import { useI18n } from './i18n';
import './diagnostics.css';

type Preview = { id: string; report: Record<string, unknown> };

export default function DiagnosticsDialog({
  onClose,
  onError,
}: {
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const { t } = useI18n();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const mounted = useRef(true);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  async function refresh() {
    setLoading(true);
    setFailure(null);
    setSaved(false);
    setPreview(null);
    try {
      const result = await request<Preview>('diagnostics.preview');
      if (mounted.current) setPreview(result);
    } catch (error) {
      if (mounted.current) {
        setFailure(errorText(error));
        onErrorRef.current(errorText(error));
      }
    } finally {
      if (mounted.current) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, []);
  async function exportPreview() {
    if (!preview || loading || exporting) return;
    setExporting(true);
    setFailure(null);
    setSaved(false);
    try {
      const result = await request<{ canceled: boolean }>('diagnostics.export', { id: preview.id });
      if (mounted.current && !result.canceled) setSaved(true);
    } catch (error) {
      if (mounted.current) {
        setFailure(errorText(error));
        onErrorRef.current(errorText(error));
      }
    } finally {
      if (mounted.current) setExporting(false);
    }
  }
  return (
    <Modal
      title={t('诊断预览与导出')}
      subtitle={t('先查看将要导出的内容，再选择 ZIP 文件保存位置。')}
      onClose={onClose}
      wide
      footer={
        <div className="diagnostics-actions">
          <button
            className="secondary-button"
            onClick={() => void refresh()}
            disabled={loading || exporting}
          >
            <RefreshCw size={15} />
            {t('重新生成预览')}
          </button>
          <button
            className="primary-button"
            onClick={() => void exportPreview()}
            disabled={!preview || loading || exporting}
          >
            {exporting ? <Spinner /> : <Download size={15} />}
            {t('导出预览为 ZIP')}
          </button>
        </div>
      }
    >
      <div className="diagnostics-dialog">
        <p className="diagnostics-description">
          {t('包含应用版本、常规设置、任务数量与运行事件。不包含会话内容、附件、密钥或文件路径。')}
        </p>
        <p className="diagnostics-description">{t('文件仅保存在你选择的位置，不会自动上传。')}</p>
        {loading ? (
          <div className="diagnostics-state" role="status">
            <Spinner />
            {t('正在生成诊断预览…')}
          </div>
        ) : (
          preview && (
            <>
              <h3 id="diagnostics-json-label">{t('完整导出内容（JSON）')}</h3>
              <pre
                className="diagnostics-json"
                tabIndex={0}
                aria-labelledby="diagnostics-json-label"
              >
                {JSON.stringify(preview.report, null, 2)}
              </pre>
            </>
          )
        )}
        {failure && (
          <div className="diagnostics-error">
            <p role="alert">{failure}</p>
            <SystemErrorDetails error={failure} />
          </div>
        )}
        {saved && (
          <p className="diagnostics-saved" role="status">
            {t('诊断包已保存。')}
          </p>
        )}
      </div>
    </Modal>
  );
}
