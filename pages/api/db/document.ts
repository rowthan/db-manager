import type { NextApiRequest, NextApiResponse } from 'next'
import {
  deleteMongoDocument,
  updateMongoDocument,
} from '../../../service/server/mongodb'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  try {
    const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body

    if (req.method === 'PUT') {
      const result = await updateMongoDocument(payload || {})
      return res.status(200).json(result)
    }

    if (req.method === 'DELETE') {
      const result = await deleteMongoDocument(payload || {})
      return res.status(200).json(result)
    }

    return res.status(405).json({ ok: false, error: 'Method Not Allowed' })
  } catch (error) {
    const message = error instanceof Error ? error.message : '文档操作失败'
    return res.status(400).json({ ok: false, error: message })
  }
}
