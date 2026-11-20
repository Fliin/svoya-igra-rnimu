export function safeUrl(value) {
  if (!value || typeof value !== 'string') return '';
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

export function mediaSource(value, kind) {
  const safe = safeUrl(value);
  if (!safe) return null;
  const url = new URL(safe);
  if (url.hostname !== 'drive.google.com') return { kind, src: safe, link: safe };
  if (url.origin !== 'https://drive.google.com') return null;

  const filePath = /^\/file\/(?:u\/\d+\/)?d\/([\w-]+)(?:\/(?:view|preview|edit))?\/?$/;
  const id = url.pathname.match(filePath)?.[1] || (url.pathname === '/open' ? url.searchParams.get('id') : '');
  if (!id || !/^[\w-]+$/.test(id)) return null;
  const preview = new URL(`/file/d/${id}/preview`, url.origin);
  const resourceKey = url.searchParams.get('resourcekey');
  if (resourceKey) preview.searchParams.set('resourcekey', resourceKey);
  const link = new URL(preview);
  link.pathname = `/file/d/${id}/view`;
  return { kind: 'drive', src: preview.href, link: link.href };
}

export function questionMedia(question, answer = false) {
  const video = answer ? question?.answerVideo : question?.video;
  const image = answer ? question?.answerImage : question?.image;
  return video ? { kind: 'video', url: video } : { kind: 'image', url: image || '' };
}

export function mediaIssues(question) {
  const issues = [];
  for (const [label, image, video] of [
    ['вопроса', question.image, question.video],
    ['ответа', question.answerImage, question.answerVideo]
  ]) {
    if (image && video) issues.push(`для ${label} выберите одну ссылку: картинку или видео`);
    if (image && !mediaSource(image, 'image')) issues.push(`некорректная ссылка на картинку ${label}`);
    if (video && !mediaSource(video, 'video')) issues.push(`некорректная ссылка на видео ${label}`);
  }
  return issues;
}
