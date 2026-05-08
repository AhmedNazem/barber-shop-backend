export type PlaceResult = {
  placeId:        string
  nameAr:         string
  nameEn:         string
  address:        string
  neighborhood:   string
  neighborhoodAr: string
  phone:          string
  lat:            number
  lng:            number
}

type AddressComponent = {
  longText:  string
  shortText: string
  types:     string[]
}

type PlacesApiPlace = {
  id:                     string
  displayName:            { text: string; languageCode: string }
  formattedAddress:       string
  location:               { latitude: number; longitude: number }
  internationalPhoneNumber?: string
  addressComponents?:     AddressComponent[]
}

type PlacesApiResponse = {
  places?: PlacesApiPlace[]
}

function extractNeighborhood(components: AddressComponent[] | undefined): string {
  if (!components) return ''
  const sublocalityTypes = ['sublocality_level_1', 'sublocality', 'neighborhood']
  for (const type of sublocalityTypes) {
    const comp = components.find(c => c.types.includes(type))
    if (comp) return comp.longText
  }
  return ''
}

export async function searchNearbyBarbers(
  lat: number,
  lng: number,
  radiusMeters = 10_000,
): Promise<PlaceResult[]> {
  const apiKey = process.env['GOOGLE_MAPS_API_KEY']
  if (!apiKey) throw new Error('GOOGLE_MAPS_API_KEY is not set')

  const res = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
    method:  'POST',
    headers: {
      'Content-Type':     'application/json',
      'X-Goog-Api-Key':   apiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.internationalPhoneNumber,places.addressComponents',
    },
    body: JSON.stringify({
      includedTypes:       ['hair_salon', 'barber_shop'],
      maxResultCount:      20,
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: radiusMeters,
        },
      },
      languageCode: 'ar',
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Places API error ${res.status}: ${text}`)
  }

  const data = await res.json() as PlacesApiResponse
  const places = data.places ?? []

  return places.map(p => {
    const neighborhood = extractNeighborhood(p.addressComponents)
    return {
      placeId:        p.id,
      nameAr:         p.displayName.text,
      nameEn:         p.displayName.text,
      address:        p.formattedAddress,
      neighborhood:   neighborhood,
      neighborhoodAr: neighborhood,
      phone:          p.internationalPhoneNumber ?? `+964-GMAPS-${p.id.slice(-8)}`,
      lat:            p.location.latitude,
      lng:            p.location.longitude,
    }
  })
}
