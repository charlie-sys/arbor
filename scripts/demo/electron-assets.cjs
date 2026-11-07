const { app, BrowserWindow } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')

const outDir = path.resolve(process.argv[2] || path.join(__dirname, '.generated'))

app.commandLine.appendSwitch('force-device-scale-factor', '2')
app.disableHardwareAcceleration()
app.on('window-all-closed', () => undefined)

const paper = `<!doctype html>
<html><head><meta charset="utf-8" /><title>Generalized State-of-Health Estimation from Partial Charging Curves with Transfer Learning</title>
<style>
  @page { size: A4; margin: 0 }
  * { box-sizing: border-box }
  body { margin: 0; font-family: "Times New Roman", "Songti SC", serif; color: #14110d }
  .page { width: 210mm; height: 297mm; padding: 16mm 15mm 14mm; page-break-after: always; position: relative }
  .page:last-child { page-break-after: auto }
  .running { position: absolute; bottom: 7mm; left: 15mm; right: 15mm; display: flex; justify-content: space-between; font-size: 7.5pt; color: #6d6459; border-top: 0.4pt solid #d8d0c4; padding-top: 2mm }
  .title { font-size: 21pt; line-height: 1.18; text-align: center; margin: 0 0 6mm; letter-spacing: -0.15pt }
  .authors { text-align: center; font-size: 11.5pt; margin: 0 0 2mm }
  .aff { text-align: center; font-size: 8.6pt; color: #4a443c; line-height: 1.4; margin: 0 0 7mm }
  .abstract { border-top: 1pt solid #b9b0a3; border-bottom: 1pt solid #b9b0a3; padding: 3.2mm 0 1.6mm; margin: 0 0 5mm; font-size: 9.1pt; line-height: 1.45; text-align: justify; column-span: all }
  .abstract b { font-variant: small-caps; letter-spacing: 0.3pt }
  .cols { column-count: 2; column-gap: 7mm; font-size: 9.3pt; line-height: 1.42; text-align: justify }
  h2 { font-size: 11.4pt; margin: 0 0 2.2mm; font-variant: small-caps; letter-spacing: 0.2pt }
  h3 { font-size: 9.9pt; margin: 3.4mm 0 1.4mm }
  p { margin: 0 0 2.2mm; text-indent: 4mm }
  p.noindent { text-indent: 0 }
  .eq { margin: 2mm 0 2.4mm; text-align: center; font-style: italic }
  figure { margin: 3mm 0; break-inside: avoid }
  figcaption { font-size: 8.1pt; color: #4a443c; text-align: justify; line-height: 1.35 }
  table { width: 100%; border-collapse: collapse; font-size: 8.2pt; margin: 2mm 0 3mm; break-inside: avoid }
  th, td { border-top: 0.4pt solid #b9b0a3; border-bottom: 0.4pt solid #b9b0a3; padding: 1.3mm 1mm; text-align: left }
  th { background: #f3eee6; font-weight: 600 }
  .refs { font-size: 8.2pt; line-height: 1.35 }
  .refs p { text-indent: -4mm; padding-left: 4mm; margin-bottom: 1.6mm }
  .kicker { font-size: 8.2pt; letter-spacing: 0.8pt; text-transform: uppercase; color: #6d6459; margin-bottom: 1mm }
</style></head><body>

<section class="page">
  <div class="kicker">Journal of Energy Storage · Preprint · 2024</div>
  <h1 class="title">Generalized State-of-Health Estimation from Partial Charging Curves with Transfer Learning</h1>
  <div class="authors">Lina Chen<sup>1</sup> &nbsp; Ming Zhao<sup>1,2</sup> &nbsp; Yuki Sato<sup>2</sup></div>
  <div class="aff"><sup>1</sup> School of Energy and Materials, Lakeside University &nbsp;·&nbsp; <sup>2</sup> Institute for Mobility Systems, Northbridge<br />
  {lina.chen, ming.zhao, yuki.sato}@example.edu</div>

  <div class="abstract"><b>Abstract.</b> Accurate state-of-health (SOH) estimation is essential for safe and reliable operation of lithium-ion batteries, yet full-cycle aging tests are slow and expensive. This work introduces a generalized data-driven approach that estimates SOH from partial charging curves without requiring complete cycles. We extract sixteen descriptors from short charging segments and train a Bayesian-tuned temporal convolution network, followed by transfer learning across NCA, NCM and LFP chemistries. On three public aging datasets the proposed method achieves a mean absolute percentage error of 1.43% and remains within 2.1% when only twenty minutes of charging data are available. Ablation studies show that cross-chemistry transfer contributes 38% of the error reduction, while calibrated uncertainty estimates flag unreliable predictions before they reach a battery management system.</div>

  <div class="cols">
    <h2>1 Introduction</h2>
    <p>Lithium-ion batteries age through a combination of calendar fading, cycling wear and operating-condition stress. Tracking state of health along the lifetime of a pack is therefore a central problem for electric vehicles, grid storage and second-life assessment. In practice, however, complete charge and discharge cycles are rarely available: field data arrive as short, irregular windows, often collected while a vehicle is parked or charging at a low rate.</p>
    <p>Existing approaches either rely on full-cycle reference tests or fit equivalent-circuit models whose parameters drift with temperature and aging. Both families struggle when the observation window is short and the chemistry differs from the training set. This paper asks a narrower but practical question: how much health information is contained in a partial charging curve, and how well does that information transfer across chemistries?</p>
    <p>We answer this question with a three-stage pipeline. First, raw voltage, current and temperature traces are resampled into fixed-length partial charging segments. Second, sixteen descriptors summarize the shape of the curve, the incremental capacity response and the thermal trajectory. Third, a temporal convolution network is tuned with Bayesian optimization and adapted across chemistries with a small amount of target-domain data.</p>
    <p>The contributions of this work are: (i) a feature set that is computable from twenty minutes of charging data; (ii) a Bayesian tuning procedure that remains stable across datasets; and (iii) a transfer protocol that reduces cross-chemistry error without target-domain labels in the source stage.</p>

    <h2>2 Related Work</h2>
    <p>Data-driven SOH estimation has moved from hand-crafted regression to deep sequence models. Convolutional and recurrent networks capture local degradation patterns, while transformer and state-space models model longer dependencies. Their performance depends strongly on the coverage of the training distribution, which is difficult to guarantee in real fleets.</p>
    <p>Physics-informed models constrain predictions with monotonic aging or electrochemical priors. They improve extrapolation but require careful calibration when the cell chemistry changes. Transfer learning offers a complementary route: a source model trained on one chemistry can be fine-tuned on a few target cells. Our work combines partial-curve features with a conservative transfer schedule and reports calibrated uncertainty alongside point estimates.</p>
  </div>
  <div class="running"><span>Chen, Zhao &amp; Sato</span><span>1 / 5</span></div>
</section>

<section class="page">
  <div class="cols">
    <h2>3 Method</h2>
    <h3>3.1 Partial charging descriptors</h3>
    <p class="noindent">Each charging segment is resampled to 128 points over a fixed voltage window. From the resampled trace we compute sixteen descriptors: five voltage-slope statistics, four incremental-capacity peaks, three thermal rates, two duration ratios and two session-level context variables. The descriptor vector is scale-normalized per chemistry before it enters the network.</p>
    <p>Partial curves are aligned at the start of the constant-current phase. Segments shorter than ten minutes are padded and flagged; the flag is provided to the model as an auxiliary input so that predictions can be attenuated when the observation is weak.</p>
    <h3>3.2 Bayesian hyperparameter tuning</h3>
    <p>We optimize learning rate, kernel width, dropout and weight decay with a Gaussian-process surrogate over 64 trials. The objective combines validation error and a stability penalty that discourages large differences between adjacent folds. The selected configuration is then frozen before transfer, which prevents target-domain leakage.</p>
    <p class="eq">L = L<sub>MAPE</sub> + λ · max(0, σ<sub>fold</sub> − σ<sub>0</sub>)</p>
    <h3>3.3 Cross-chemistry transfer</h3>
    <p>The source model is trained on NCA cells and adapted to NCM and LFP targets in two stages. First, batch-normalization statistics are re-estimated on unlabeled target segments. Second, the last temporal block and the regression head are fine-tuned with a reduced learning rate. This schedule preserves the shape priors learned from the source chemistry while allowing the output scale to shift.</p>
    <p>Uncertainty is estimated with Monte Carlo dropout at inference time. A prediction is marked unreliable when the predictive standard deviation exceeds a threshold calibrated on held-out source cells. In deployment, unreliable predictions are routed to a slower reference test rather than silently accepted.</p>

    <h2>4 Experimental Setup</h2>
    <p>We evaluate on three public aging datasets covering NCA, NCM and LFP cells. Each dataset is split by cell identifier, not by time window, to avoid leakage between training and test segments. Charging segments are extracted from the raw logs without manual cleaning; malformed sessions are dropped only when the current trace is missing for more than 30% of the window.</p>
    <p>The source model is trained on 42 NCA cells. Target adaptation uses 6 labeled NCM cells and 4 labeled LFP cells. All models are trained for at most 120 epochs with early stopping. Reported errors are averaged over five random seeds.</p>
  </div>
  <div class="running"><span>Generalized SOH estimation</span><span>2 / 5</span></div>
</section>

<section class="page">
  <div class="cols">
    <h2>5 Results</h2>
    <p>Table 1 summarizes the main comparison. The proposed model outperforms the strongest baseline by 0.31 percentage points in MAPE and reduces the worst-case error on short segments from 4.8% to 3.2%. Gains are consistent across the three chemistries, although LFP remains the most difficult target.</p>
    <figure>
      <svg viewBox="0 0 620 260" width="100%" xmlns="http://www.w3.org/2000/svg">
        <rect x="0" y="0" width="620" height="260" fill="#fbf8f3" stroke="#d8d0c4" stroke-width="1"/>
        <g stroke="#e2dbcf" stroke-width="1">
          <line x1="60" y1="30" x2="60" y2="210"/><line x1="60" y1="210" x2="585" y2="210"/>
          <line x1="60" y1="165" x2="585" y2="165" stroke-dasharray="3 4"/>
          <line x1="60" y1="120" x2="585" y2="120" stroke-dasharray="3 4"/>
          <line x1="60" y1="75" x2="585" y2="75" stroke-dasharray="3 4"/>
        </g>
        <text x="60" y="20" font-size="11" fill="#4a443c">MAPE (%)</text>
        <text x="585" y="228" font-size="10" fill="#4a443c" text-anchor="end">Partial charging window (min)</text>
        <text x="48" y="214" font-size="9" fill="#6d6459" text-anchor="end">0</text>
        <text x="48" y="169" font-size="9" fill="#6d6459" text-anchor="end">1</text>
        <text x="48" y="124" font-size="9" fill="#6d6459" text-anchor="end">2</text>
        <text x="48" y="79" font-size="9" fill="#6d6459" text-anchor="end">3</text>
        <polyline points="90,100 170,112 250,126 330,138 410,146 490,152 570,157" fill="none" stroke="#8b9d77" stroke-width="3"/>
        <polyline points="90,80 170,94 250,118 330,140 410,160 490,174 570,184" fill="none" stroke="#b28d6f" stroke-width="2.4" stroke-dasharray="7 5"/>
        <polyline points="90,130 170,150 250,168 330,180 410,190 490,197 570,202" fill="none" stroke="#9a9084" stroke-width="2.2"/>
        <circle cx="330" cy="138" r="4" fill="#8b9d77"/><circle cx="490" cy="152" r="4" fill="#8b9d77"/>
        <g font-size="9.5" fill="#4a443c">
          <rect x="418" y="42" width="18" height="4" fill="#8b9d77"/><text x="442" y="48">Ours (transfer)</text>
          <rect x="418" y="62" width="18" height="4" fill="#b28d6f"/><text x="442" y="68">Transfer, no fine-tune</text>
          <rect x="418" y="82" width="18" height="4" fill="#9a9084"/><text x="442" y="88">Baseline TCN</text>
        </g>
      </svg>
      <figcaption><b>Figure 1.</b> Error as a function of the available charging window. The proposed transfer schedule is more stable when fewer than thirty minutes of data are available.</figcaption>
    </figure>
    <table>
      <thead><tr><th>Model</th><th>NCA</th><th>NCM</th><th>LFP</th><th>Worst</th></tr></thead>
      <tbody>
        <tr><td>Equivalent circuit + LR</td><td>3.21</td><td>3.64</td><td>4.12</td><td>5.60</td></tr>
        <tr><td>TCN (no transfer)</td><td>1.84</td><td>2.41</td><td>2.86</td><td>4.80</td></tr>
        <tr><td>PINN baseline</td><td>1.72</td><td>2.18</td><td>2.55</td><td>4.10</td></tr>
        <tr><td>Ours</td><td>1.18</td><td>1.43</td><td>1.67</td><td>3.20</td></tr>
      </tbody>
    </table>
    <p class="noindent" style="font-size:8.2pt;color:#4a443c">Table 1. MAPE (%) across chemistries and the worst-case error on short segments.</p>
    <p>Figure 1 shows that the advantage is largest when the charging window is short. With ten minutes of data, the baseline degrades sharply, whereas the proposed model retains a usable estimate and increases its predictive variance. This behavior is desirable in a monitoring system: the model becomes less confident before it becomes wrong.</p>
  </div>
  <div class="running"><span>Chen, Zhao &amp; Sato</span><span>3 / 5</span></div>
</section>

<section class="page">
  <div class="cols">
    <h2>6 Ablation and Sensitivity</h2>
    <p>Removing cross-chemistry transfer increases MAPE by 0.62 points on average, concentrated in the LFP target. Removing the thermal descriptors increases the worst-case error by 0.9 points, which suggests that temperature context is important when the charging window is short. The Bayesian stability penalty contributes a smaller but consistent improvement of 0.08 points.</p>
    <p>Window length is the dominant factor. Beyond forty minutes, additional data yield diminishing returns; below fifteen minutes, the auxiliary weak-window flag is essential. We also vary the number of target cells used for fine-tuning. With only two target cells the model still improves over the no-transfer baseline, but the variance across seeds grows noticeably.</p>
    <h3>6.1 Calibration</h3>
    <p>Predictive intervals are calibrated on held-out source cells and evaluated on target cells. The empirical coverage of the 90% interval is 88.4% on NCM and 86.9% on LFP. Coverage is conservative for long windows and slightly optimistic for the shortest ones. We therefore recommend a temperature-dependent threshold rather than a single global cutoff.</p>
    <h3>6.2 Failure cases</h3>
    <p>Two failure modes remain. First, sessions with abrupt current interruptions produce discontinuities that are not represented in the training data. Second, cells with unusually flat voltage plateaus yield ambiguous incremental-capacity peaks. Both cases are flagged by the uncertainty head in most runs, but not all of them; a rule-based sanity check is still required in production.</p>

    <h2>7 Discussion and Limitations</h2>
    <p>The results support a practical conclusion: partial charging curves carry enough information for useful SOH estimation, provided that the model is explicit about its uncertainty and its chemistry coverage. The transfer schedule is deliberately conservative, which limits peak accuracy on a single chemistry but improves robustness across chemistries.</p>
    <p>Our evaluation covers three chemistries and laboratory aging protocols. Real fleets introduce additional variation: sensor placement, charger behavior, seasonal temperature and user driving patterns. Generalization to unseen chemistries remains sensitive to the length of the partial charging window, and the current feature set does not model cell-to-cell heterogeneity inside a pack.</p>
    <p>A second limitation is the reliance on a small number of target cells. While the transfer protocol is designed for label scarcity, the variance across seeds indicates that more target data would be beneficial. Future work will study active sampling strategies that choose which cells to label first.</p>
  </div>
  <div class="running"><span>Generalized SOH estimation</span><span>4 / 5</span></div>
</section>

<section class="page">
  <div class="cols">
    <h2>8 Conclusion</h2>
    <p>We presented a generalized approach for estimating battery state of health from partial charging curves. Sixteen descriptors, a Bayesian-tuned temporal network and a conservative transfer schedule together achieve 1.43% MAPE across three chemistries while exposing calibrated uncertainty. The method is designed for online monitoring, where complete cycles are unavailable and predictions must be accompanied by a reliability signal.</p>
    <p>Beyond accuracy, the experiment highlights a design principle: a health estimator should know when it is out of distribution. In our runs, the uncertainty head identified most short-window and interrupted-session failures before they reached the downstream system. We believe this property is as important as the point estimate itself.</p>
    <p>Future work will extend the descriptor set to pack-level heterogeneity, incorporate charger metadata, and evaluate the pipeline on field data from second-life battery deployments.</p>

    <h2>References</h2>
    <div class="refs">
      <p>[1] A. Bernard et al. “A review of lithium-ion battery aging mechanisms.” Journal of Energy Storage, 2021.</p>
      <p>[2] K. Ito, R. Alvarez. “Partial charging signatures for health monitoring.” Applied Energy, 2022.</p>
      <p>[3] M. Novak et al. “Bayesian optimization for deep battery models.” Energy and AI, 2023.</p>
      <p>[4] S. Park, L. Chen. “Early-life predictive modeling of battery aging.” e-Energy, 2023.</p>
      <p>[5] R. Kumar, Y. Sato. “Selective state-space models for health prognostics.” Energy and AI, 2024.</p>
      <p>[6] F. Wang, J. Lu. “Physics-informed degradation modeling.” Applied Energy, 2023.</p>
      <p>[7] H. Huang, Y. Zhang. “Data-driven battery health management: a survey.” Renewable and Sustainable Energy Reviews, 2021.</p>
      <p>[8] Y. Li, H. Chen. “Joint SOC and SOH estimation with hybrid models.” Journal of Power Sources, 2022.</p>
    </div>
  </div>
  <div class="running"><span>Chen, Zhao &amp; Sato</span><span>5 / 5</span></div>
</section>

</body></html>`

const translationPages = [
  {
    name: 'translation-original-1',
    lang: 'en',
    body: `
      <p class="kicker">Journal of Energy Storage · Results</p>
      <p class="para">The proposed model achieves a mean absolute percentage error of 1.43% across the evaluated chemistries. When only twenty minutes of charging data are available, the error remains below 2.1%, whereas the baseline degrades to 3.7%. The gap is largest for LFP cells, where the flat voltage plateau makes partial-curve features less distinctive.</p>
      <figure>${chartSvg()}</figure>
      <p class="cap"><b>Figure 3.</b> SOH estimation error versus available charging window. Solid line: proposed transfer model; dashed line: baseline without transfer.</p>`
  },
  {
    name: 'translation-translated-1',
    lang: 'zh',
    body: `
      <p class="kicker">Journal of Energy Storage · 结果</p>
      <p class="para">所提出的模型在评估的三种化学体系上取得了 1.43% 的平均绝对百分比误差。当仅能获得 20 分钟充电数据时，误差仍低于 2.1%，而基线模型会退化到 3.7%。LFP 电芯上的差距最大，因为其平坦的电压平台使部分充电曲线特征不够显著。</p>
      <figure>${chartSvg(true)}</figure>
      <p class="cap"><b>图 3.</b> SOH 估计误差随可用充电窗口变化。实线：本文迁移模型；虚线：未迁移的基线模型。</p>`
  },
  {
    name: 'translation-original-2',
    lang: 'en',
    body: `
      <p class="kicker">Section 3.2 · Method</p>
      <p class="para">We optimize learning rate, kernel width, dropout and weight decay with a Gaussian-process surrogate over 64 trials. The objective combines validation error and a stability penalty that discourages large differences between adjacent folds.</p>
      <div class="formula">L = L<sub>MAPE</sub> + λ · max(0, σ<sub>fold</sub> − σ<sub>0</sub>)</div>
      <p class="para">The selected configuration is frozen before transfer, which prevents target-domain leakage. Batch-normalization statistics are then re-estimated on unlabeled target segments.</p>
      <div class="callout">Two-stage transfer: (1) re-estimate normalization on unlabeled target data; (2) fine-tune the last temporal block and regression head.<br />No target labels are used in the source stage.</div>`
  },
  {
    name: 'translation-translated-2',
    lang: 'zh',
    body: `
      <p class="kicker">第 3.2 节 · 方法</p>
      <p class="para">我们使用高斯过程代理模型在 64 次试验中优化学习率、卷积核宽度、丢弃率与权重衰减。目标函数同时考虑验证误差与稳定性惩罚，以抑制相邻折之间的过大差异。</p>
      <div class="formula">L = L<sub>MAPE</sub> + λ · max(0, σ<sub>fold</sub> − σ<sub>0</sub>)</div>
      <p class="para">选定的配置在迁移前被冻结，以避免目标域信息泄漏。随后在无标签的目标域片段上重新估计批归一化统计量。</p>
      <div class="callout">两阶段迁移：（1）在无标签目标数据上重新估计归一化参数；（2）微调最后一个时序模块与回归头。<br />源阶段不使用任何目标域标签。</div>`
  },
  {
    name: 'translation-original-3',
    lang: 'en',
    body: `
      <p class="kicker">Supplementary · Experimental protocol</p>
      <p class="para">Experiments are conducted at 25 °C with NCA, NCM and LFP cells. All charging segments start at 10% state of charge and are truncated at different cut-off voltages. To avoid data leakage, training and test sets are split by cell identifier rather than by time window.</p>
      <table><thead><tr><th>Chemistry</th><th>Cells</th><th>Segments</th><th>Window</th></tr></thead><tbody>
        <tr><td>NCA</td><td>42</td><td>3,180</td><td>20 min</td></tr>
        <tr><td>NCM</td><td>28</td><td>2,406</td><td>20 min</td></tr>
        <tr><td>LFP</td><td>19</td><td>1,572</td><td>25 min</td></tr>
      </tbody></table>
      <p class="cap">Table S1. Dataset composition after quality filtering. Windows shorter than ten minutes are retained but flagged.</p>`
  },
  {
    name: 'translation-translated-3',
    lang: 'zh',
    body: `
      <p class="kicker">补充材料 · 实验方案</p>
      <p class="para">实验在 25 °C 下进行，分别使用 NCA、NCM 与 LFP 电芯。所有充电片段均从 10% 荷电状态开始，并在不同截止电压处截断。为避免数据泄漏，训练集与测试集按电芯编号划分，而不是按时间窗口划分。</p>
      <table><thead><tr><th>体系</th><th>电芯数</th><th>片段数</th><th>窗口</th></tr></thead><tbody>
        <tr><td>NCA</td><td>42</td><td>3,180</td><td>20 分钟</td></tr>
        <tr><td>NCM</td><td>28</td><td>2,406</td><td>20 分钟</td></tr>
        <tr><td>LFP</td><td>19</td><td>1,572</td><td>25 分钟</td></tr>
      </tbody></table>
      <p class="cap">表 S1. 质量过滤后的数据集构成。短于 10 分钟的窗口会保留，但会被标记。</p>`
  }
]

function chartSvg(zh) {
  const labels = zh
    ? ['本文模型', '无迁移基线']
    : ['Ours (transfer)', 'Baseline, no transfer']
  return `<svg viewBox="0 0 560 210" width="100%" xmlns="http://www.w3.org/2000/svg">
    <rect width="560" height="210" fill="#fbf8f3" stroke="#ddd5c8"/>
    <g stroke="#e6dfd3"><line x1="48" y1="20" x2="48" y2="168"/><line x1="48" y1="168" x2="530" y2="168"/><line x1="48" y1="120" x2="530" y2="120" stroke-dasharray="3 4"/><line x1="48" y1="72" x2="530" y2="72" stroke-dasharray="3 4"/></g>
    <text x="48" y="14" font-size="10" fill="#5b5248">MAPE (%)</text>
    <text x="530" y="186" font-size="9.5" fill="#5b5248" text-anchor="end">${zh ? '充电窗口（分钟）' : 'Charging window (min)'}</text>
    <polyline points="80,62 150,80 220,98 290,112 360,123 430,132 500,140" fill="none" stroke="#8b9d77" stroke-width="3"/>
    <polyline points="80,42 150,62 220,92 290,118 360,138 430,152 500,162" fill="none" stroke="#b28d6f" stroke-width="2.4" stroke-dasharray="7 5"/>
    <circle cx="290" cy="112" r="4" fill="#8b9d77"/>
    <g font-size="9" fill="#4a443c"><rect x="330" y="30" width="16" height="3" fill="#8b9d77"/><text x="352" y="35">${labels[0]}</text><rect x="330" y="46" width="16" height="3" fill="#b28d6f"/><text x="352" y="51">${labels[1]}</text></g>
  </svg>`
}

function translationHtml(body, lang) {
  return `<!doctype html><html><head><meta charset="utf-8" /><style>
    * { box-sizing: border-box }
    body { margin: 0; width: 900px; height: 560px; overflow: hidden; background: #fffdf9; color: #26221d; font-family: ${lang === 'zh' ? '"Microsoft YaHei UI", "Segoe UI", sans-serif' : '"Times New Roman", Georgia, serif'} }
    .sheet { padding: 42px 56px; }
    .kicker { font-family: "Segoe UI", sans-serif; font-size: 12px; letter-spacing: 1.4px; text-transform: uppercase; color: #8a7f71; margin: 0 0 16px }
    .para { font-size: ${lang === 'zh' ? '16px' : '15.5px'}; line-height: 1.85; margin: 0 0 14px; text-align: justify }
    figure { margin: 18px 0 10px }
    .cap { font-size: 12.5px; line-height: 1.6; color: #5b5248; margin: 6px 0 0 }
    .formula { margin: 20px 0; padding: 16px 22px; background: #f6f0e6; border-radius: 10px; font-family: Georgia, serif; font-size: 18px; font-style: italic; text-align: center }
    .callout { margin-top: 20px; padding: 16px 20px; border-left: 3px solid #8b9d77; background: #f3f6ee; font-size: 13.5px; line-height: 1.75; color: #3f4a35 }
    table { width: 100%; border-collapse: collapse; font-size: 13px; margin: 16px 0 8px }
    th, td { border-top: 1px solid #d8d0c4; border-bottom: 1px solid #d8d0c4; padding: 8px 6px; text-align: left }
    th { background: #f5efe6 }
  </style></head><body><div class="sheet">${body}</div></body></html>`
}

async function capture(html, name) {
  const source = path.join(outDir, `${name}.html`)
  await fs.writeFile(source, html, 'utf-8')
  const win = new BrowserWindow({
    width: 900,
    height: 560,
    show: false,
    frame: false,
    backgroundColor: '#fffdf9',
    webPreferences: { offscreen: false, backgroundThrottling: false }
  })
  await win.loadFile(source)
  await new Promise((resolve) => setTimeout(resolve, 350))
  const image = await win.webContents.capturePage()
  await fs.writeFile(path.join(outDir, `${name}.png`), image.toPNG())
  win.destroy()
  await fs.unlink(source).catch(() => undefined)
}

app.whenReady().then(async () => {
  await fs.mkdir(outDir, { recursive: true })
  const paperSource = path.join(outDir, 'demo-paper.html')
  await fs.writeFile(paperSource, paper, 'utf-8')
  const paperWin = new BrowserWindow({ show: false, width: 900, height: 1200, webPreferences: { offscreen: false } })
  await paperWin.loadFile(paperSource)
  await new Promise((resolve) => setTimeout(resolve, 500))
  const pdf = await paperWin.webContents.printToPDF({
    printBackground: true,
    preferCSSPageSize: true,
    generateDocumentOutline: true
  })
  await fs.writeFile(path.join(outDir, 'demo-paper.pdf'), pdf)
  paperWin.destroy()
  await fs.unlink(paperSource).catch(() => undefined)

  for (const page of translationPages) {
    await capture(translationHtml(page.body, page.lang), page.name)
  }
  console.log(`generated assets in ${outDir}`)
  app.quit()
})
