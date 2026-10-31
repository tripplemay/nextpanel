const regions: Record<string, string> = {
  'ap-guangzhou': '广州', 'ap-chengdu': '成都', 'ap-shanghai': '上海', 'ap-beijing': '北京',
  'ap-nanjing': '南京', 'ap-hongkong': '香港', 'ap-singapore': '新加坡', 'ap-tokyo': '东京',
};

export function cfProfileLabel(profile: string): string {
  if (profile?.startsWith('REGION:')) {
    const key = profile.slice(7);
    return `${regions[key] ?? key}云测优选`;
  }
  return ({ GENERIC: '通用候选', DNS: '默认 CDN', MANUAL: '手动候选' } as Record<string, string>)[profile]
    ?? '历史候选（未标注地区）';
}
