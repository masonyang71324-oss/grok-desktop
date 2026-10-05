export const architecture: Record<string, string> = {
  '实际占用 {used} / {limit}': 'Physical storage {used} / {limit}',
  至少可回收: 'At least reclaimable',
  '相同内容由多个检查点共享。每条记录显示单独删除时至少可回收的空间；同时删除多条可能回收更多。':
    'Checkpoints share identical content. Each record shows the minimum space reclaimed when deleted alone; deleting several may reclaim more.',
  '新版本正在分批推送，轮到此设备时即可更新。':
    'The new version is rolling out gradually. It will be available when this device is included.',
  只自动批准已确认的读取操作: 'Automatically approve verified reads only',
  '仅自动批准已验证的官方读取工具；写入、命令和未知操作仍需确认。':
    'Only verified built-in reads are approved automatically. Writes, commands and unknown operations still need approval.',
  意外断线后尝试一次自动重连: 'Try reconnecting once after an unexpected disconnect',
  '只恢复连接，不自动重发任务或继续队列。失败后可手动重连。':
    'Restores the connection without resending tasks or resuming the queue. If it fails, reconnect manually.',
  更新通道: 'Update channel',
  '稳定版（推荐）': 'Stable (recommended)',
  测试版: 'Beta',
  '测试版可提前体验新功能。切回稳定版会等待更新的正式版，不会自动降级。':
    'Beta offers early access to new features. Switching back waits for a newer stable release without downgrading.',
};
