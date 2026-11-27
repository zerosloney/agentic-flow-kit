// errors.mjs — 规则系统异常定义单源，供 model、yaml、adapters、load 共同引用，打破循环依赖
export class RulesConfigError extends Error {
  constructor(message) {
    super(message);
    this.code = 'RULES_CONFIG';
  }
}
