import { Router } from 'express'
import { authenticate } from '@/middleware/auth'
import { singleImage } from '@/lib/upload'
import { submitHairAnalysisHandler, getHairAnalysisHandler } from '@/controllers/hair-analysis.controller'

export const hairAnalysisRouter = Router()

hairAnalysisRouter.post('/',        authenticate, singleImage('image'), submitHairAnalysisHandler)
hairAnalysisRouter.get('/:jobId',   getHairAnalysisHandler)
