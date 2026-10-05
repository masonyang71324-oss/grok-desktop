export const approvalUsability: Record<string, string> = {
  操作工作目录: 'Working directory',
  工具未提供工作目录: 'No working directory provided',
  操作影响: 'Operation impact',
  删除文件或目录: 'Deletes files or folders',
  '此命令包含删除操作，文件可能不会进入回收站。请核对目标路径。':
    'This command includes deletion. Files may bypass the recycle bin. Check the target paths.',
  丢弃未提交的修改: 'Discards uncommitted changes',
  'git reset --hard 会重置已跟踪文件，并丢弃其中未提交的修改。':
    'git reset --hard resets tracked files and discards their uncommitted changes.',
  改写远程分支历史: 'Rewrites remote branch history',
  '强制推送可能改写远程分支已有提交，请确认分支和协作者的变更。':
    'A force push may replace existing commits on the remote branch. Check the branch and collaborators’ changes.',
  查看完整原始数据: 'View complete original data',
};
