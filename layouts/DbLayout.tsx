import { PropsWithChildren } from 'react'
import Head from 'next/head'

export default function DbLayout(
  props: PropsWithChildren<{
    title?: string
    description?: string
  }>
) {
  const { children, ...customMeta } = props

  const meta = {
    title: customMeta.title || '数据库操作',
    description: customMeta.description || '独立的数据库查询页面',
    type: 'website',
  }

  return (
    <>
      <Head>
        <title>{meta.title}</title>
        <meta name="robots" content="noindex, nofollow" />
        <meta content={meta.description} name="description" />
        <meta property="og:type" content={meta.type} />
        <meta property="og:title" content={meta.title} />
        <meta property="og:description" content={meta.description} />
      </Head>
      <main className="mx-auto min-h-screen bg-base-100 text-base-content">
        {children}
      </main>
    </>
  )
}
