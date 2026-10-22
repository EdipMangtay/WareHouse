import { useState } from 'react';
import type { Decision } from '../../../../../packages/contracts/research';
export function DecisionInspector({ decisions }: {
    decisions: Decision[];
}) {
    const [id, setId] = useState('');
    const decision = decisions.find(d => d.id === id) ?? decisions[decisions.length - 1];
    return <section className="lab-panel lab-decisions"><div className="lab-panel-title"><h2>Decision Inspector</h2>
    <select aria-label="Karar kaydı" value={decision?.id ?? ''} onChange={e => setId(e.target.value)}>{[...decisions].reverse().map(d => <option key={d.id} value={d.id}>{d.id} · {d.time_s.toFixed(1)} s · {d.trigger}</option>)}</select></div>
    {decision ? <><p>{decision.explanation}</p><div className="lab-facts"><span>Tetikleyici <b>{decision.trigger}</b></span><span>Hesaplama <b>{decision.compute_ms.toFixed(2)} ms</b></span><span>Değerlendirme <b>{decision.evaluations} / {decision.budget}</b></span><span>Bağlılık aralığı <b>{decision.commitment_s} s</b></span></div>
      <p className="lab-muted">Robot seçimi: {decision.robot_rule}. Aynı aday kümesi: {decision.cohort.join(', ') || '—'}.</p>
      <details><summary>Uygulanan öncelikler</summary><div className="lab-priorities"><div><b>Hazırlama</b><ol>{decision.preparation.map(t => <li key={t}>{t}</li>)}</ol></div><div><b>Konveyör</b><ol>{decision.conveyor.map(t => <li key={t}>{t}</li>)}</ol></div></div></details>
      {decision.candidates.length ? <div className="lab-table-wrap"><table><thead><tr><th>Aday</th><th>Tahmini ortalama / ceza (s)</th><th>Açık sipariş</th><th>Fiziksel uygunluk</th></tr></thead><tbody>{decision.candidates.map(c => <tr key={c.evaluation}><td>{c.evaluation}</td><td>{c.score?.toFixed(2) ?? '—'}</td><td>{c.open_orders}</td><td>{c.feasible ? 'Geçerli' : 'Geçersiz'}</td></tr>)}</tbody></table></div> : <p className="lab-muted">Bu kararda alternatif plan değerlendirilmedi. Karşılaştırmalı etki hesaplanmadı.</p>}
      {decision.fallback && <p role="status">Arama uygulanabilir aday bulamadı; ortak fiziksel denetimden geçen referans plan kullanılıyor.</p>}
    </> : <p className="lab-muted">İlk adımla birlikte gerçek karar kayıtları burada görünür.</p>}
  </section>;
}
