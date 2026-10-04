export const checkpointReview: Record<string, string> = {
  当前项目: 'Current project',
  检查点存储管理: 'Checkpoint storage',
  所有项目的检查点存储: 'Checkpoint storage across all projects',
  '检查点不会自动清理。只删除你选中的记录，项目文件保持不变。':
    'Checkpoints are not deleted automatically. Only selected records are removed; project files stay unchanged.',
  '已使用 {used} / {limit}': '{used} used of {limit}',
  选择可删除记录: 'Select removable records',
  清除选择: 'Clear selection',
  删除所选记录: 'Delete selected records',
  '删除所选检查点记录？': 'Delete selected checkpoints?',
  '将删除 {count} 条恢复记录。删除后无法再使用这些记录恢复文件，项目文件保持不变。':
    'Delete {count} restore records? They can no longer restore files after deletion. Project files stay unchanged.',
  恢复撤销记录: 'Restore undo record',
  记录不可读: 'Unreadable record',
  项目未知: 'Unknown project',
  正在记录: 'Recording',
  运行中不可删除: 'Cannot delete while recording',
  '{count} 个文件': '{count} files',
  '本轮未创建检查点，无法恢复本轮文件。':
    'No checkpoint was created for this turn. Its files cannot be restored.',
  '检查点不完整，无法完整恢复本轮文件。':
    'This checkpoint is incomplete. It cannot restore all files from this turn.',
  '未记录到可恢复变更，不代表本轮没有文件变化。':
    'No restorable changes were recorded. This does not mean no files changed.',
};
