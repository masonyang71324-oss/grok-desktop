export function effortPresets(model) {
  if (model?._meta?.supportsReasoningEffort === false) return [];
  const options = model?._meta?.reasoningEfforts || [];
  const value = (option) => option?.value || option?.id;
  const find = (id) => options.find((option) => value(option) === id);
  const recommended = options.find((option) => option.default) || find('medium') || find('high');
  if (!recommended) return [];
  const result = [];
  const quick = find('low') || find('minimal');
  if (quick && value(quick) !== value(recommended))
    result.push({
      id: 'quick',
      value: value(quick),
      label: '快速',
      description: '使用较低推理档位，适合简单任务。',
    });
  result.push({
    id: 'standard',
    value: value(recommended),
    label: '标准',
    description: recommended.default ? '使用模型推荐的推理档位。' : '使用标准推理档位。',
  });
  const deep = ['ultra', 'max', 'xhigh', 'high'].map(find).find(Boolean);
  if (deep && value(deep) !== value(recommended) && value(deep) !== value(quick))
    result.push({
      id: 'deep',
      value: value(deep),
      label: '深入',
      description: '使用更高推理档位，适合复杂任务，可能等待更久。',
    });
  return result;
}
