// Phase P8: concepts for search by meaning. Each concept groups words that name the same scientific idea, in English
// and Chinese, so a student who writes "corpus" finds "dataset", and "准确率" finds "accuracy". It runs in the
// browser: nothing is sent anywhere. Two passages sharing a concept are related in topic, not proven equivalent.

export type Concept = { id: string; label: string; en: string[]; zh: string[] };

const C = (id: string, label: string, en: string, zh: string): Concept => ({ id, label, en: en.split('|'), zh: zh ? zh.split('|') : [] });

export const CONCEPTS: Concept[] = [
  // Data
  C('dataset', 'dataset', 'dataset|data set|corpus|corpora|benchmark|database|data collection|collected data|samples|observations|records', '数据集|语料|语料库|样本|数据库|基准数据|观测数据'),
  C('data_source', 'data source', 'data source|primary data|secondary data|survey data|sensor data|field data|archival data', '数据来源|一手数据|二手数据|调查数据|传感器数据|实测数据'),
  C('preprocessing', 'preprocessing', 'preprocessing|pre-processing|data cleaning|normalization|normalisation|feature extraction|feature engineering|tokenization', '预处理|数据清洗|归一化|标准化|特征提取|特征工程'),
  C('split', 'data split', 'train/test split|training set|test set|validation set|held-out|cross-validation|k-fold', '训练集|测试集|验证集|交叉验证|划分'),
  C('annotation', 'annotation', 'annotation|labelling|labeling|ground truth|labels|annotated', '标注|标签|真值'),
  C('sample_size', 'sample size', 'sample size|number of participants|respondents|participants|subjects|n =', '样本量|样本数|受访者|被试|参与者'),
  // Models and methods
  C('neural_network', 'neural network', 'neural network|deep learning|deep neural|neural model|multilayer perceptron|mlp', '神经网络|深度学习|深度神经网络|多层感知机'),
  C('cnn', 'convolutional network', 'convolutional neural network|cnn|convolution|convnet|resnet', '卷积神经网络|卷积|残差网络'),
  C('rnn', 'recurrent network', 'recurrent neural network|rnn|lstm|long short-term memory|gru|recurrent memory|sequence model', '循环神经网络|长短期记忆|门控循环|递归神经网络'),
  C('transformer', 'transformer', 'transformer|attention mechanism|self-attention|bert|gpt|large language model|llm', '注意力机制|自注意力|大语言模型|大模型'),
  C('tree_model', 'tree-based model', 'random forest|decision tree|gradient boosting|xgboost|lightgbm|boosted trees', '随机森林|决策树|梯度提升'),
  C('svm', 'support vector machine', 'support vector machine|svm|kernel method', '支持向量机|核方法'),
  C('regression', 'regression', 'regression|linear model|logistic regression|least squares|ols', '回归|线性模型|逻辑回归|最小二乘'),
  C('clustering', 'clustering', 'clustering|k-means|unsupervised grouping|cluster analysis', '聚类|k均值'),
  C('baseline', 'baseline', 'baseline|benchmark method|reference model|state of the art|sota|persistence', '基线|基准方法|对比方法|现有方法'),
  C('model', 'model', 'model|architecture|framework|algorithm|approach|network', '模型|架构|框架|算法|方法'),
  C('optimization', 'optimisation', 'optimization|optimisation|optimizer|gradient descent|adam|sgd|loss function|objective function', '优化|优化器|梯度下降|损失函数|目标函数'),
  C('hyperparameter', 'hyperparameter', 'hyperparameter|learning rate|batch size|epochs|layers|hidden units|dropout|regularization', '超参数|学习率|批大小|迭代次数|层数|正则化'),
  C('training', 'training', 'training|trained|fitting|learning|fine-tuning|fine tuning', '训练|拟合|微调|学习'),
  C('simulation', 'simulation', 'simulation|simulated|numerical model|monte carlo', '仿真|模拟|数值模型|蒙特卡洛'),
  C('statistical_test', 'statistical test', 'significance|statistical test|t-test|anova|chi-square|p-value|p <|confidence interval', '显著性|统计检验|t检验|方差分析|卡方|置信区间'),
  C('survey', 'survey or interview', 'survey|questionnaire|interview|focus group|likert', '问卷|调查|访谈|焦点小组|李克特'),
  C('case_study', 'case study', 'case study|qualitative study|ethnography|grounded theory', '案例研究|质性研究|扎根理论'),
  C('experiment', 'experiment', 'experiment|experimental|trial|ablation|controlled study|test run', '实验|试验|消融|对照实验'),
  C('forecasting', 'forecasting', 'forecast|forecasting|prediction|predict|predictive|projection|nowcasting', '预测|预报|预估'),
  C('classification', 'classification', 'classification|classifier|categorization|detection|recognition', '分类|分类器|识别|检测'),
  C('segmentation', 'segmentation', 'segmentation|semantic segmentation|instance segmentation', '分割|语义分割'),
  C('remote_sensing', 'remote sensing', 'remote sensing|satellite|imagery|radar|lidar', '遥感|卫星|影像|雷达|激光雷达'),
  C('time_series', 'time series', 'time series|temporal|sequence|hourly|daily|horizon', '时间序列|时序|逐小时|逐日|预测时长'),
  C('flood', 'flood and hydrology', 'flood|flooding|runoff|river|streamflow|discharge|hydrolog|rainfall|precipitation', '洪水|洪涝|径流|河流|流量|水文|降雨|降水'),
  C('weather', 'weather and climate', 'weather|climate|meteorolog|temperature|wind|atmospher', '天气|气候|气象|温度|风速|大气'),
  // Evaluation
  C('accuracy', 'accuracy', 'accuracy|correct rate|classification rate', '准确率|正确率|精度'),
  C('precision_recall', 'precision and recall', 'precision|recall|f1|f-score|f-measure|sensitivity|specificity', '精确率|召回率|f1值|灵敏度|特异度'),
  C('error_metric', 'error measure', 'rmse|root mean square error|mae|mean absolute error|mse|mean squared error|mape|error rate', '均方根误差|平均绝对误差|均方误差|误差'),
  C('auc', 'AUC', 'auc|roc|area under the curve', '曲线下面积|roc曲线'),
  C('r2', 'R²', 'r2|r^2|r-squared|coefficient of determination|nse|nash-sutcliffe', '决定系数|纳什效率系数'),
  C('text_metric', 'text quality measure', 'bleu|rouge|meteor|perplexity|cider', '困惑度'),
  C('detection_metric', 'detection measure', 'map|mean average precision|iou|intersection over union', '平均精度均值|交并比'),
  C('evaluation', 'evaluation', 'evaluation|evaluate|metric|performance|assessment|validation', '评估|评价|指标|性能|验证'),
  C('reliability', 'reliability and validity', 'reliability|validity|cronbach|internal consistency|robustness|reproducibility', '信度|效度|稳健性|可重复性'),
  // Research design
  C('problem', 'research problem', 'research problem|problem statement|challenge|open problem|research gap|gap|little is known|unresolved', '研究问题|问题陈述|挑战|研究空白|不足'),
  C('objective', 'objective', 'objective|aim|goal|purpose|this study aims|we aim|we propose', '目的|目标|旨在|本文提出'),
  C('question', 'research question', 'research question|rq1|rq2|rq3|we ask|guiding question', '研究问题|科学问题'),
  C('hypothesis', 'hypothesis', 'hypothesis|hypotheses|we hypothesize|we expect|h1|h2', '假设|假说'),
  C('theory', 'theoretical framework', 'theoretical framework|theory|conceptual framework|theoretical model|paradigm', '理论框架|理论基础|概念框架|范式'),
  C('literature', 'prior work', 'related work|literature review|prior work|previous studies|earlier studies|existing research|state of the art', '相关工作|文献综述|已有研究|前人研究|研究现状'),
  C('method_design', 'research design', 'methodology|research design|method|procedure|protocol|workflow|pipeline', '研究方法|研究设计|方法|流程|方案'),
  C('result', 'result', 'result|finding|outcome|we found|shows that|outperform|improvement|improve', '结果|发现|结论表明|优于|提高|提升'),
  C('limitation', 'limitation', 'limitation|limited|weakness|shortcoming|threat to validity|caveat', '局限|不足|缺陷|限制'),
  C('future_work', 'future work', 'future work|future research|further research|next step|outlook', '未来工作|进一步研究|展望|今后'),
  C('contribution', 'contribution', 'contribution|novelty|we contribute|original|innovation', '贡献|创新|创新点'),
  C('ethics', 'ethics', 'ethics|ethical|consent|privacy|anonymi', '伦理|知情同意|隐私|匿名'),
  C('sensor', 'sensor and measurement', 'sensor|gauge|instrument|measurement|monitoring station', '传感器|测站|仪器|测量|监测站'),
  C('sparse', 'sparse or scarce data', 'sparse|scarce|limited data|few samples|data scarcity|missing data', '稀疏|稀缺|数据不足|缺失数据'),
  C('generalization', 'generalisation', 'generalization|generalisation|transfer|domain shift|out-of-distribution|unseen', '泛化|迁移|领域偏移'),
  C('efficiency', 'efficiency', 'efficiency|computational cost|runtime|inference time|latency|complexity', '效率|计算成本|运行时间|推理时间|复杂度'),
  C('interpretability', 'interpretability', 'interpretability|explainability|explainable|shap|feature importance', '可解释性|特征重要性'),
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PATTERNS = CONCEPTS.map((c) => ({
  c,
  // English words match at word starts, so "hydrolog" covers hydrology and hydrological.
  // Short words must be whole words ("map" is not "mapping"), with an optional plural.
  en: new RegExp(`(?:^|[^a-z0-9])(?:${c.en.map((w) => escape(w.toLowerCase()).replace(/ /g, '[\\s-]+') + (w.length <= 4 ? 's?(?![a-z0-9])' : '')).join('|')})`, 'i'),
  zh: c.zh,
}));

/** The concepts a text mentions. */
export function conceptsOf(text: string): Set<string> {
  const t = text.toLowerCase();
  const out = new Set<string>();
  for (const { c, en, zh } of PATTERNS) if (en.test(t) || zh.some((w) => t.includes(w))) out.add(c.id);
  return out;
}

export const conceptLabel = (id: string) => CONCEPTS.find((c) => c.id === id)?.label ?? id;

/** Very general concepts say little on their own: they only help when something more specific also matches. */
export const WEAK_CONCEPTS = new Set(['model', 'evaluation', 'training', 'result', 'method_design', 'experiment']);
