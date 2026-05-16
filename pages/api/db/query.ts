import type { NextApiRequest, NextApiResponse } from 'next'
import { queryMongoDocuments } from '../../../service/server/mongodb'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method Not Allowed' })
  }

  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    const result = await queryMongoDocuments(payload || {})
    return res.status(200).json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'MongoDB 查询失败'
    return res.status(400).json({
      ok: false,
      error: message,
    })
  }
}
