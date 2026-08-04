/**
 * 用户名搜索 - Netlify Function
 * 并发检测 20 个社交平台 + GitHub API 详情
 */
const { json, parseBody, httpGet, httpGetJson } = require('./_shared');

const SOCIAL_PLATFORMS = [
  { name: 'GitHub', url: 'https://github.com/{u}', icon: 'github', category: '代码/开发', api: 'github' },
  { name: 'Reddit', url: 'https://www.reddit.com/user/{u}', icon: 'reddit', category: '社区' },
  { name: 'YouTube', url: 'https://www.youtube.com/@{u}', icon: 'youtube', category: '视频' },
  { name: 'Steam', url: 'https://steamcommunity.com/id/{u}', icon: 'steam', category: '游戏' },
  { name: 'Dev.to', url: 'https://dev.to/{u}', icon: 'devto', category: '代码/开发' },
  { name: 'Medium', url: 'https://medium.com/@{u}', icon: 'medium', category: '博客' },
  { name: 'Keybase', url: 'https://keybase.io/{u}', icon: 'keybase', category: '加密通讯' },
  { name: 'Pinterest', url: 'https://www.pinterest.com/{u}/', icon: 'pinterest', category: '图片' },
  { name: 'Twitch', url: 'https://www.twitch.tv/{u}', icon: 'twitch', category: '直播' },
  { name: 'Patreon', url: 'https://www.patreon.com/{u}', icon: 'patreon', category: '创作' },
  { name: 'Twitter/X', url: 'https://x.com/{u}', icon: 'twitter', category: '社交' },
  { name: 'Telegram', url: 'https://t.me/{u}', icon: 'telegram', category: '即时通讯' },
  { name: 'Instagram', url: 'https://www.instagram.com/{u}/', icon: 'instagram', category: '社交' },
  { name: 'TikTok', url: 'https://www.tiktok.com/@{u}', icon: 'tiktok', category: '短视频' },
  { name: 'Spotify', url: 'https://open.spotify.com/user/{u}', icon: 'spotify', category: '音乐' },
  { name: 'Vimeo', url: 'https://vimeo.com/{u}', icon: 'vimeo', category: '视频' },
  { name: 'Dribbble', url: 'https://dribbble.com/{u}', icon: 'dribbble', category: '设计' },
  { name: 'Behance', url: 'https://www.behance.net/{u}', icon: 'behance', category: '设计' },
  { name: 'SoundCloud', url: 'https://soundcloud.com/{u}', icon: 'soundcloud', category: '音乐' },
  { name: 'Flickr', url: 'https://www.flickr.com/people/{u}', icon: 'flickr', category: '摄影' },
];

async function checkOne(plat, username) {
  const profileUrl = plat.url.replace('{u}', username);
  const r = await httpGet(profileUrl, 5000);
  let exists = r.status === 200;
  if ((r.status === 301 || r.status === 302) && r.url) {
    exists = r.url.toLowerCase().includes(username.toLowerCase());
  }

  let detail = null;
  if (exists && plat.api === 'github') {
    const gh = await httpGetJson(`https://api.github.com/users/${username}`, 4000, { Accept: 'application/vnd.github+json' });
    if (gh) {
      detail = {
        avatar: gh.avatar_url || '', bio: gh.bio || '', name: gh.name || '',
        company: gh.company || '', blog: gh.blog || '', location: gh.location || '',
        followers: gh.followers || 0, following: gh.following || 0,
        public_repos: gh.public_repos || 0, created_at: gh.created_at || '',
      };
    }
  }

  return {
    platform: plat.name, url: profileUrl, icon: plat.icon, category: plat.category,
    exists, status_code: r.status || 0, detail,
  };
}

exports.handler = async (event) => {
  const { username } = parseBody(event);
  if (!username) return json(400, { error: '请输入用户名' });
  if (!/^[a-zA-Z0-9_\-.]{2,30}$/.test(username)) {
    return json(400, { error: '用户名格式无效（仅支持字母、数字、下划线、连字符、点号，2-30位）' });
  }

  const results = await Promise.allSettled(
    SOCIAL_PLATFORMS.map((p) => checkOne(p, username).catch(() => ({
      platform: p.name, url: p.url.replace('{u}', username), icon: p.icon,
      category: p.category, exists: false, status_code: 0, error: true, detail: null,
    })))
  );

  const list = results.map((r) => (r.status === 'fulfilled' ? r.value : r.reason));
  list.sort((a, b) => (a.exists === b.exists ? a.platform.localeCompare(b.platform) : a.exists ? -1 : 1));
  const found = list.filter((r) => r.exists);
  return json(200, {
    username,
    total_platforms: list.length,
    found_count: found.length,
    found,
    not_found: list.filter((r) => !r.exists),
    all: list,
  });
};
