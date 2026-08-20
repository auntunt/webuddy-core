/**
 * 最终判定：汇总环节状态、计算通过条件。
 *
 * 从 evaluate 结果计算：
 * - 项目整体状态
 * - 是否可以进入下一环节
 * - 关键指标汇总
 */

/**
 * 计算项目整体状态。
 *
 * @param {object} evalResult - evaluate() 的返回值
 * @returns {object} { status, message, canProceed }
 */
export function computeVerdict(evalResult) {
  const { stages, counts, currentStage } = evalResult;

  // 当前环节状态
  const currentStageData = stages.find(s => s.id === currentStage);

  let status;
  let message;
  let canProceed = false;

  if (!currentStageData) {
    status = 'unknown';
    message = '无法确定当前环节';
    return { status, message, canProceed };
  }

  // 根据当前环节状态判定
  switch (currentStageData.state) {
    case 'passed':
      status = 'passed';
      message = `环节${currentStage} ${currentStageData.name} 已通过`;
      canProceed = true;
      break;
    case 'blocked':
      status = 'blocked';
      message = `环节${currentStage} 被 ${currentStageData.hardFails.length} 条必须项阻断`;
      canProceed = false;
      break;
    case 'fixing':
      status = 'fixing';
      message = `环节${currentStage} 有 ${counts.fixNow + counts.failNow} 条待改进`;
      canProceed = (currentStageData.hardFails || []).length === 0 && (currentStageData.hardFixes || []).length === 0;
      break;
    case 'waiting':
      status = 'waiting';
      message = `环节${currentStage} 有 ${counts.askNow} 条待确认`;
      canProceed = false;
      break;
    case 'untouched':
      status = 'untouched';
      message = `环节${currentStage} 尚未开始`;
      canProceed = false;
      break;
    case 'notyet':
      status = 'notyet';
      message = `环节${currentStage} 暂未触及`;
      canProceed = false;
      break;
    default:
      status = 'unknown';
      message = '状态未知';
      canProceed = false;
  }

  // 计算整体完成度
  const progress = counts.total > 0 ? Math.round((counts.pass / counts.total) * 100) : 0;

  return {
    status,
    message,
    canProceed,
    progress,
    currentStage,
    stageName: currentStageData.name,
    blocking: counts.blockingNow,
    stats: {
      total: counts.total,
      pass: counts.pass,
      fail: counts.failNow,
      fix: counts.fixNow,
      ask: counts.askNow,
      na: counts.na,
    },
  };
}

/**
 * 判断项目是否完成。
 *
 * @param {object} evalResult - evaluate() 的返回值
 * @returns {boolean} 所有环节是否通过
 */
export function isComplete(evalResult) {
  return evalResult.stages.every(s => s.state === 'passed' || s.state === 'notyet');
}

/**
 * 获取下一步建议。
 *
 * @param {object} evalResult - evaluate() 的返回值
 * @returns {object|null} { gateId, stage, action } 或 null
 */
export function getNextAction(evalResult) {
  const { stages, verdictById, currentStage } = evalResult;

  // 找到当前环节第一个未通过的门禁
  const currentStageData = stages.find(s => s.id === currentStage);
  if (!currentStageData) return null;

  // 优先级：fail > fix > ask
  const pick = [...currentStageData.fails, ...currentStageData.fixes, ...currentStageData.asks][0];
  if (!pick) return null;

  const verdict = verdictById.get(pick);
  if (!verdict) return null;

  return {
    gateId: pick,
    stage: currentStage,
    stageName: currentStageData.name,
    action: verdict.r === 'fail' ? '不通过，需要修正' : verdict.r === 'fix' ? '待改进' : '待确认',
    detail: verdict.detail || '',
  };
}
