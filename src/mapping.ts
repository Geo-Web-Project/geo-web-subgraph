import { BigInt } from "@graphprotocol/graph-ts"
import { DirectionPath, GeoWebCoordinate, GeoWebCoordinatePath, u256 } from "as-geo-web-coordinate/assembly"
import {
  GeoWebParcel,
  MintGeoWebParcel
} from "../generated/GeoWebParcel/GeoWebParcel"
import { LandParcel, GeoJSONMultiPolygon, GeoJSONPolygon, GeoJSONCoordinate } from "../generated/schema"
import { BigDecimal } from '@graphprotocol/graph-ts'
import { log } from '@graphprotocol/graph-ts'

export function handleMintGeoWebParcel(event: MintGeoWebParcel): void {
  // Entities can be loaded from the store using a string ID; this ID
  // needs to be unique across all entities of the same type
  let entity = LandParcel.load(event.params._id.toHex())
  let multiPolyEntity = GeoJSONMultiPolygon.load(event.params._id.toHex())

  // Entities only exist after they have been saved to the store;
  // `null` checks allow to create entities on demand
  if (entity == null) {
    entity = new LandParcel(event.params._id.toHex())
    entity.type = "Feature"
  }

  if (multiPolyEntity == null) {
    multiPolyEntity = new GeoJSONMultiPolygon(event.params._id.toHex())
    multiPolyEntity.type = "MultiPolygon"
  }

  let contract = GeoWebParcel.bind(event.address)
  let parcel = contract.getLandParcel(event.params._id)

  let numPaths = parcel.value1.length
  let paths: BigInt[] = parcel.value1

  let coordIDs = new Array<string>(numPaths*124)

  let currentCoord = <u64>Number.parseInt(parcel.value0.toHex().slice(2), 16)
  let currentPath: u256 = new u256(0)
  let p_i = 0
  let i = 0
  if (numPaths > 0 && !paths[p_i].isZero()) {
    currentPath = u256.fromUint8ArrayLE(paths[p_i])
  }
  do {
    savePolygon(currentCoord)
    coordIDs[i] = currentCoord.toString()
    i += 1

    let hasNext = GeoWebCoordinatePath.hasNext(currentPath)

    let directionPath: DirectionPath
    if (!hasNext) {
      // Try next path
      p_i += 1
      if (p_i >= numPaths) {
        break;
      }
      currentPath = u256.fromUint8ArrayLE(paths[p_i])
    }

    directionPath = GeoWebCoordinatePath.nextDirection(currentPath)
    currentPath = directionPath.path

    // Traverse to next coordinate
    currentCoord = GeoWebCoordinate.traverse(currentCoord, directionPath.direction)
  } while (true)


  multiPolyEntity.coordinates = coordIDs
  entity.geometry = multiPolyEntity.id
  
  multiPolyEntity.save()
  entity.save()
}

function savePolygon(gwCoord: u64): void {
  let polygonEntity = GeoJSONPolygon.load(gwCoord.toString())

  if (polygonEntity == null) {
    polygonEntity = new GeoJSONPolygon(gwCoord.toString())
    polygonEntity.type = "Polygon"
  }

  let coords = GeoWebCoordinate.to_gps(gwCoord).map<BigDecimal>((v: f64) => {
    return BigDecimal.fromString(v.toString())
  })

  for (let i = 0; i < coords.length; i += 2) {
    let lon = coords[i];
    let lat = coords[i+1];
    let coordID = lon.toString() + ";" + lat.toString()
    let coordinateEntity = GeoJSONCoordinate.load(coordID)
    if (coordinateEntity == null) {
      coordinateEntity = new GeoJSONCoordinate(coordID)
    }

    coordinateEntity.lon = lon
    coordinateEntity.lat = lat

    switch (i) {
      case 0:
        polygonEntity.pointBL = coordinateEntity.id
        break;
      case 2:
        polygonEntity.pointBR = coordinateEntity.id
        break;
      case 4:
        polygonEntity.pointTR = coordinateEntity.id
        break;
      case 6:
        polygonEntity.pointTL = coordinateEntity.id
        break;
    }
    coordinateEntity.save()
  }
  
  polygonEntity.save()
}