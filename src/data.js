// 內建資料：以 JSON module 靜態載入，屬於「載入頁面本身」，執行期不再發出任何請求。
import lexicon from '../data/lexicon.json' with { type: 'json' };
import observable from '../data/observable.json' with { type: 'json' };
import templates from '../data/templates.json' with { type: 'json' };

export { lexicon, observable, templates };
