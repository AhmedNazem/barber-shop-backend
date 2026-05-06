import { Router } from 'express'
import { authenticate } from '@/middleware/auth'
import { requireRole } from '@/middleware/require-role'
import { singleImage } from '@/lib/upload'
import { submitHairAnalysisHandler, getHairAnalysisHandler } from '@/controllers/hair-analysis.controller'

export const hairAnalysisRouter = Router()

hairAnalysisRouter.post('/',        authenticate, requireRole('CUSTOMER'), singleImage('image'), submitHairAnalysisHandler)
hairAnalysisRouter.get('/:jobId',   getHairAnalysisHandler)
