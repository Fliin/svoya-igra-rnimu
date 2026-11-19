export const MAX_EXCEL_SIZE = 5 * 1024 * 1024;
export function inspectXlsxArchive(buffer) {
  const bytes = new Uint8Array(buffer), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length > MAX_EXCEL_SIZE) throw new Error('Excel-файл слишком большой. Допустимо до 5 МБ.');
  if (bytes.length < 22 || view.getUint32(0, true) !== 0x04034b50) throw new Error('Выберите файл Excel в формате .xlsx.');
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--) if (view.getUint32(p, true) === 0x06054b50) { end = p; break; }
  if (end < 0) throw new Error('Файл Excel повреждён.');
  const count = view.getUint16(end+10, true), offset = view.getUint32(end+16, true);
  if (count > 500 || offset > bytes.length) throw new Error('Слишком сложная книга Excel. Используйте шаблон.');
  let total = 0, p = offset;
  for (let i=0; i<count; i++) {
    if (p+46 > bytes.length || view.getUint32(p,true) !== 0x02014b50) throw new Error('Повреждена структура Excel-файла.');
    if (view.getUint16(p+8,true)&1) throw new Error('Снимите защиту паролем с Excel-файла.');
    total += view.getUint32(p+24,true);
    if (total > 32*1024*1024) throw new Error('Содержимое Excel-файла слишком большое. Используйте шаблон без лишних листов и картинок.');
    p += 46 + view.getUint16(p+28,true) + view.getUint16(p+30,true) + view.getUint16(p+32,true);
  }
}
export function readExcelRows(buffer, xlsx = globalThis.XLSX) {
  if (!xlsx) throw new Error('Не загрузился модуль Excel. Обновите страницу и попробуйте снова.');
  inspectXlsxArchive(buffer);
  let book;
  try { book = xlsx.read(buffer, { type: 'array', sheetRows: 10002, cellHTML: false, bookVBA: false }); }
  catch { throw new Error('Не удалось прочитать книгу. Сохраните её как .xlsx без пароля.'); }
  const name = book.SheetNames.find(n => n.trim().toLocaleLowerCase('ru-RU') === 'вопросы') || book.SheetNames[0];
  if (!name) throw new Error('В книге нет листов.');
  const sheet = book.Sheets[name];
  const range = xlsx.utils.decode_range(sheet['!fullref'] || sheet['!ref'] || 'A1');
  if (range.e.r > 10000 || range.e.c > 100) throw new Error('Слишком большая таблица. Допустимо до 10 000 вопросов и 100 колонок.');
  return xlsx.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false, blankrows: true });
}
