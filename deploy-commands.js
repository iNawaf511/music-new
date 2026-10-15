import { REST, Routes, SlashCommandBuilder } from 'discord.js';

const commands = [
  new SlashCommandBuilder()
    .setName('play')
    .setDescription('شغّل موسيقى من يوتيوب (رابط أو كلمات بحث)')
    .addStringOption(opt =>
      opt.setName('query').setDescription('رابط يوتيوب أو كلمات البحث').setRequired(true)
    ),
  new SlashCommandBuilder()
    .setName('pause')
    .setDescription('إيقاف مؤقت للموسيقى'),
  new SlashCommandBuilder()
    .setName('resume')
    .setDescription('استئناف تشغيل الموسيقى'),
  new SlashCommandBuilder()
    .setName('skip')
    .setDescription('تخطي الأغنية الحالية'),
  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('إيقاف الموسيقى ومسح قائمة التشغيل'),
  new SlashCommandBuilder()
    .setName('queue')
    .setDescription('عرض قائمة التشغيل الحالية'),
  new SlashCommandBuilder()
    .setName('nowplaying')
    .setDescription('عرض الأغنية التي تعزف الآن'),
  new SlashCommandBuilder()
    .setName('seek')
    .setDescription('تقديم 10 ثواني في المقطع الحالي'),
  new SlashCommandBuilder()
    .setName('volume')
    .setDescription('ضبط مستوى الصوت (1-100)')
    .addIntegerOption(opt =>
      opt.setName('level').setDescription('مستوى الصوت من 1 إلى 100').setRequired(true).setMinValue(1).setMaxValue(100)
    ),
  new SlashCommandBuilder()
    .setName('download')
    .setDescription('تحميل مقطع من يوتيوب أو تيك توك أو أي موقع')
    .addStringOption(opt =>
      opt.setName('url').setDescription('رابط المقطع').setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('format')
        .setDescription('نوع التحميل')
        .setRequired(false)
        .addChoices(
          { name: 'صوت فقط (MP3)', value: 'audio' },
          { name: 'فيديو فقط (MP4)', value: 'video' },
          { name: 'صوت + فيديو (MP4)', value: 'both' }
        )
    ),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

try {
  console.log('بدء تسجيل الأوامر...');
  await rest.put(
    Routes.applicationCommands(process.env.DISCORD_APPLICATION_ID),
    { body: commands }
  );
  console.log('تم تسجيل الأوامر بنجاح!');
} catch (err) {
  console.error('خطأ في تسجيل الأوامر:', err);
  process.exit(1);
}
