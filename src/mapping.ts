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
  GeoPoint,
  Bid
} from "../generated/schema";
import { Transfer } from "../generated/ERC721License/ERC721License";
import { AuctionSuperApp } from "../generated/AuctionSuperApp/AuctionSuperApp";

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
  let licenseId = event.parameters[0].value.toBigInt();
  let license = ERC721License.load(licenseId.toHex());

  if (license == null) {
    license = new ERC721License(licenseId.toHex());
  }

  let contract = AuctionSuperApp.bind(event.address);
  let currentOwnerBidData = contract.currentOwnerBid(licenseId);

  let currentOwnerBidId = license.owner.toHex() + "-" + licenseId.toHex();
  let currentOwnerBid = Bid.load(currentOwnerBidId);

  if (currentOwnerBid == null) {
    currentOwnerBid = new Bid(currentOwnerBidId);
  }

  currentOwnerBid.timestamp = currentOwnerBidData.value0;
  currentOwnerBid.bidder = currentOwnerBidData.value1;
  currentOwnerBid.contributionRate = currentOwnerBidData.value2;
  currentOwnerBid.perSecondFeeNumerator = currentOwnerBidData.value3;
  currentOwnerBid.perSecondFeeDenominator = currentOwnerBidData.value4;
  currentOwnerBid.forSalePrice = currentOwnerBidData.value5;
  currentOwnerBid.save();

  let outstandingBidData = contract.outstandingBid(licenseId);

  let outstandingBidId =
    outstandingBidData.value1.toHex() + "-" + licenseId.toHex();
  let outstandingBid = Bid.load(outstandingBidId);

  if (outstandingBid == null) {
    outstandingBid = new Bid(outstandingBidId);
  }

  outstandingBid.timestamp = outstandingBidData.value0;
  outstandingBid.bidder = outstandingBidData.value1;
  outstandingBid.contributionRate = outstandingBidData.value2;
  outstandingBid.perSecondFeeNumerator = outstandingBidData.value3;
  outstandingBid.perSecondFeeDenominator = outstandingBidData.value4;
  outstandingBid.forSalePrice = outstandingBidData.value5;
  outstandingBid.save();

  license.currentOwnerBid = currentOwnerBid.id;
  license.outstandingBid = outstandingBid.id;
  license.save();
}
