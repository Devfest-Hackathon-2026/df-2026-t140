import type { Firestore } from 'firebase-admin/firestore'
import type { AiGatePort } from '../../ports/aiGate'
import type { PlacesApiPort } from '../../ports/places-api'

/** 場所の口コミを聞くときに、外の世界に頼むもの。handler が adapters の実体を渡す */
export interface PlaceReviewsPorts {
  db: Firestore
  aiGate: Pick<AiGatePort, 'isUnlocked'>
  placesApi: Pick<PlacesApiPort, 'reviewsEnabled' | 'reviews' | 'findPlaceId' | 'sampleMode'>
}
