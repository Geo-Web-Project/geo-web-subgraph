import { BigInt } from "@graphprotocol/graph-ts"
import { GeoWebCoordinate } from "as-geo-web-coordinate/assembly"
import {
  GeoWebParcel,
  MintGeoWebParcel
} from "../generated/GeoWebParcel/GeoWebParcel"
import { LandParcel, GeoJSONPolygon, GeoJSONCoordinate } from "../generated/schema"
import { BigDecimal } from '@graphprotocol/graph-ts'
import { log } from '@graphprotocol/graph-ts'

export function handleMintGeoWebParcel(event: MintGeoWebParcel): void {
  // Entities can be loaded from the store using a string ID; this ID
  // needs to be unique across all entities of the same type
  let entity = LandParcel.load(event.params._id.toHex())
  let polygonEntity = GeoJSONPolygon.load(event.params._id.toHex())

  // Entities only exist after they have been saved to the store;
  // `null` checks allow to create entities on demand
  if (entity == null) {
    entity = new LandParcel(event.params._id.toHex())
  }

  if (polygonEntity == null) {
    polygonEntity = new GeoJSONPolygon(event.params._id.toHex())
  }

  let contract = GeoWebParcel.bind(event.address)
  let parcel = contract.getLandParcel(event.params._id)
  
  let coords = GeoWebCoordinate.to_gps_hex(parcel.value0.toHex()).map<BigDecimal[]>((v1: string[]) => {
    return v1.map<BigDecimal>((v2: string) => {
      return BigDecimal.fromString(v2)
    })
  })

  let coordIDs = new Array<string>(coords.length)

  for (let i = 0; i < coords.length; i++) {
    let coord = coords[i];
    let coordID = coord[0].toString() + ";" + coord[1].toString()
    let coordinateEntity = GeoJSONCoordinate.load(coordID)
    if (coordinateEntity == null) {
      coordinateEntity = new GeoJSONCoordinate(coordID)
    }

    coordinateEntity.lon = coord[0]
    coordinateEntity.lat = coord[1]

    coordIDs[i] = coordinateEntity.id
    coordinateEntity.save()
  }
  
  polygonEntity.type = "Polygon"
  polygonEntity.coordinates = coordIDs

  entity.polygon = polygonEntity.id
  
  polygonEntity.save()
  entity.save()

  // Note: If a handler doesn't require existing field values, it is faster
  // _not_ to load the entity from the store. Instead, create it fresh with
  // `new Entity(...)`, set the fields that should be updated and save the
  // entity back to the store. Fields that were not set or unset remain
  // unchanged, allowing for partial updates to be applied.

  // It is also possible to access smart contracts from mappings. For
  // example, the contract that has emitted the event can be connected to
  // with:
  //
  // let contract = Contract.bind(event.address)
  //
  // The following functions can then be called on this contract to access
  // state variables and other data:
  //
  // - contract.DEFAULT_ADMIN_ROLE(...)
  // - contract.MINTER_ROLE(...)
  // - contract.availabilityIndex(...)
  // - contract.getRoleAdmin(...)
  // - contract.getRoleMember(...)
  // - contract.getRoleMemberCount(...)
  // - contract.hasRole(...)
  // - contract.getLandParcel(...)
}