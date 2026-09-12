import Link from 'next/link';
import { ArrowUpRight, BookOpen, Rocket } from 'lucide-react';
import { appNames } from '@/lib/shared';
import { localizePath, type Locale } from '@/lib/i18n';
import type { Metadata } from 'next';

const previewImages = [
  {
    src: 'https://i.ibb.co/TDFvGWDT/image.png',
    title: { en: 'Canvas composition', 'zh-CN': '画布编排' },
  },
  {
    src: 'https://i.ibb.co/zVwJq3YS/image.png',
    title: { en: 'AI generation', 'zh-CN': 'AI 生成' },
  },
  {
    src: 'https://i.ibb.co/PvY3qhhK/image.png',
    title: { en: 'Reference editing', 'zh-CN': '参考素材编辑' },
  },
  {
    src: 'https://i.ibb.co/7D04LwN/image.png',
    title: { en: 'Node workflow', 'zh-CN': '节点工作流' },
  },
];

const messages = {
  en: {
    eyebrow: 'TDTV AI canvas workspace',
    center: 'Documentation',
    description: 'Learn how to run TDCanvas, organize node-based creative workflows, manage local assets, and connect your own model services.',
    quickStart: 'Quick Start',
    gallery: 'Gallery',
    features: 'Explore Features',
    previewAlt: 'TDCanvas preview',
  },
  'zh-CN': {
    eyebrow: 'TDTV AI 画布工作空间',
    center: '文档中心',
    description: '了解如何启动 TDCanvas、组织节点式创作流程、管理本地素材，并连接你自己的模型服务。',
    quickStart: '快速开始',
    gallery: '效果展示',
    features: '功能介绍',
    previewAlt: 'TDCanvas 效果图',
  },
};

export default async function HomePage({ params }: PageProps<'/[lang]'>) {
  const { lang } = await params;
  const locale = lang as Locale;
  const text = messages[locale];
  const appName = appNames[locale];

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-5 pb-16 pt-8 md:px-10 md:pt-14">
      <section className="grid min-h-[520px] items-center gap-10 border-b border-zinc-200 pb-12 dark:border-zinc-800 lg:grid-cols-[0.88fr_1.12fr]">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            <Rocket className="size-3.5 text-emerald-600 dark:text-emerald-400" />
            {text.eyebrow}
          </div>
          <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-tight text-zinc-950 dark:text-zinc-50 md:text-6xl [font-family:var(--font-display)]">
            {appName}
            <span className="block text-zinc-500 dark:text-zinc-400">{text.center}</span>
          </h1>
          <p className="mt-6 max-w-2xl text-base leading-8 text-zinc-600 dark:text-zinc-400">
            {text.description}
          </p>
          <div className="mt-8">
            <Link
              href={localizePath(locale, '/docs/overview/quick-start')}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-zinc-950 px-5 py-3 text-sm font-medium text-white transition hover:bg-zinc-800 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              <BookOpen className="size-4" />
              {text.quickStart}
            </Link>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl lg:w-[108%] lg:max-w-none">
          <img
            src={previewImages[3].src}
            alt={text.previewAlt}
            className="aspect-[16/10] w-full rounded-xl object-cover"
          />
        </div>
      </section>

      <section className="mt-14">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <h2 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50 md:text-3xl">
            {text.gallery}
          </h2>
          <Link
            href={localizePath(locale, '/docs/overview/features')}
            className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-zinc-800 transition hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-white"
          >
            {text.features}
            <ArrowUpRight className="size-4" />
          </Link>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {previewImages.map((item) => (
            <img
              key={item.src}
              src={item.src}
              alt={item.title[locale]}
              loading="lazy"
              decoding="async"
              className="aspect-[16/10] w-full rounded-2xl object-cover"
            />
          ))}
        </div>
      </section>
    </main>
  );
}

export async function generateMetadata({ params }: PageProps<'/[lang]'>): Promise<Metadata> {
  const { lang } = await params;
  const locale = lang as Locale;
  const text = messages[locale];

  return {
    title: `${appNames[locale]} ${text.center}`,
    description: text.description,
    alternates: {
      languages: {
        en: '/',
        'zh-CN': '/zh-CN',
      },
    },
  };
}
