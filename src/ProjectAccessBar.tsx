import { useState } from 'react';
import { ShieldCheck, LockKeyhole } from 'lucide-react';
import { useI18n } from './i18n';
import { errorText } from './lib';
import './project-access.css';
export default function ProjectAccessBar({
  cwd,
  trusted,
  onChange,
  notify,
}: {
  cwd: string;
  trusted: boolean;
  onChange: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  return (
    <button
      className={`project-access ${trusted ? '' : 'restricted'}`}
      disabled={busy}
      title={`${cwd}\n${t(trusted ? '此项目允许任务、终端和文件修改；点击管理信任。' : '当前只看文件；信任后可发送任务和修改文件。')}`}
      onClick={async () => {
        setBusy(true);
        try {
          await onChange();
        } catch (error) {
          notify(errorText(error));
        } finally {
          setBusy(false);
        }
      }}
    >
      {trusted ? <ShieldCheck size={13} /> : <LockKeyhole size={13} />}
      <span>{t(trusted ? '已信任' : '只看文件')}</span>
    </button>
  );
}
