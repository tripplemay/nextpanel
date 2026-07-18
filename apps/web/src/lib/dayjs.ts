import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';

// dayjs 唯一初始化入口：插件与语言在此配置一次，全局不要再重复 extend/locale
dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

export default dayjs;
