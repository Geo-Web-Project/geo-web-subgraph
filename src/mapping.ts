import {
  ethereum,
  Address,
  BigInt,
  BigDecimal,
  ByteArray
} from "@graphprotocol/graph-ts";
import {
  DirectionPath,
  GeoWebCoordinate,
  GeoWebCoordinatePath,
  u256
} from "as-geo-web-coordinate/assembly";
import {
  GeoWebParcel,
  ParcelBuilt
} from "../generated/GeoWebParcel/GeoWebParcel";
import {
  ERC721License,
  LandParcel,
  GeoWebCoordinate as GWCoord,
  GeoPoint
} from "../generated/schema";
import { Transfer } from "../generated/ERC721License/ERC721License";
import {
  AuctionSuperApp,
  BidPlaced
} from "../generated/AuctionSuperApp/AuctionSuperApp";

export function handleParcelBuilt(event: ParcelBuilt): void {
  // Entities can be loaded from the store using a string ID; this ID
  // needs to be unique across all entities of the same type
  let landParcelEntity = LandParcel.load(event.params._id.toHex());

  // Entities only exist after they have been saved to the store;
  // `null` checks allow to create entities on demand
  if (landParcelEntity == null) {
    landParcelEntity = new LandParcel(event.params._id.toHex());
    landParcelEntity.license = event.params._id.toHex();
  }

  let contract = GeoWebParcel.bind(event.address);
  let parcel = contract.getLandParcel(event.params._id);

  let numPaths = parcel.value1.length;
  let paths: BigInt[] = parcel.value1;

  let coordIDs = new Array<string>(numPaths * 124);

  let currentCoord = <u64>Number.parseInt(parcel.value0.toHex().slice(2), 16);
  let currentPath: u256 = new u256(0);
  let p_i = 0;
  let i = 0;
  if (numPaths > 0 && !paths[p_i].isZero()) {
    currentPath = u256.fromUint8ArrayLE(paths[p_i]);
  }
  do {
    saveGWCoord(currentCoord, landParcelEntity.id, event);
    coordIDs[i] = currentCoord.toString();
    i += 1;

    let hasNext = GeoWebCoordinatePath.hasNext(currentPath);

    let directionPath: DirectionPath;
    if (!hasNext) {
      // Try next path
      p_i += 1;
      if (p_i >= numPaths) {
        break;
      }
      currentPath = u256.fromUint8ArrayLE(paths[p_i]);
    }

    directionPath = GeoWebCoordinatePath.nextDirection(currentPath);
    currentPath = directionPath.path;

    // Traverse to next coordinate
    currentCoord = GeoWebCoordinate.traverse(
      currentCoord,
      directionPath.direction
    );
  } while (true);

  landParcelEntity.coordinates = coordIDs;

  landParcelEntity.save();
}

function saveGWCoord(
  gwCoord: u64,
  landParcelID: string,
  event: ParcelBuilt
): void {
  let entity = GWCoord.load(gwCoord.toString());

  if (entity == null) {
    entity = new GWCoord(gwCoord.toString());
  }

  let coords = GeoWebCoordinate.to_gps(gwCoord).map<BigDecimal>((v: f64) => {
    return BigDecimal.fromString(v.toString());
  });

  for (let i = 0; i < coords.length; i += 2) {
    let lon = coords[i];
    let lat = coords[i + 1];
    let coordID = lon.toString() + ";" + lat.toString();
    let pointEntity = GeoPoint.load(coordID);
    if (pointEntity == null) {
      pointEntity = new GeoPoint(coordID);
    }

    pointEntity.lon = lon;
    pointEntity.lat = lat;

    switch (i) {
      case 0:
        entity.pointBL = pointEntity.id;
        break;
      case 2:
        entity.pointBR = pointEntity.id;
        break;
      case 4:
        entity.pointTR = pointEntity.id;
        break;
      case 6:
        entity.pointTL = pointEntity.id;
        break;
    }
    pointEntity.save();
  }

  entity.landParcel = landParcelID;
  entity.createdAtBlock = event.block.number;
  let coordX: i32 = GeoWebCoordinate.get_x(gwCoord);
  let coordY: i32 = GeoWebCoordinate.get_y(gwCoord);
  entity.coordX = BigInt.fromI32(coordX);
  entity.coordY = BigInt.fromI32(coordY);
  entity.save();
}

export function handleLicenseTransfer(event: Transfer): void {
  let entity = ERC721License.load(event.params.tokenId.toHex());

  if (entity == null) {
    entity = new ERC721License(event.params.tokenId.toHex());
  }

  entity.owner = event.params.to;
  entity.landParcel = event.params.tokenId.toHex();
  entity.save();
}

export function handleBidEvent(event: ethereum.Event): void {
  let entity = ERC721License.load(event.parameters[0].value.toBigInt().toHex());

  if (entity == null) {
    entity = new ERC721License(event.parameters[0].value.toBigInt().toHex());
  }

  let contract = AuctionSuperApp.bind(event.address);
  let bid = contract.currentOwnerBid(event.parameters[0].value.toBigInt());

  entity.contributionRate = bid.value2;
  entity.perSecondFeeNumerator = bid.value3;
  entity.perSecondFeeDenominator = bid.value4;
  entity.forSalePrice = bid.value5;
  entity.save();
}
