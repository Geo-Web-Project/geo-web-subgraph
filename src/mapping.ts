import {
  ethereum,
  Address,
  BigInt,
  BigDecimal,
  ByteArray,
} from "@graphprotocol/graph-ts";
import {
  DirectionPath,
  GeoWebCoordinate,
  GeoWebCoordinatePath,
  u256,
} from "as-geo-web-coordinate/assembly";
import {
  GeoWebParcel,
  Bidder,
  GeoWebCoordinate as GWCoord,
  GeoPoint,
  Bid,
} from "../generated/schema";
import {
  Transfer,
  RegistryDiamond,
  ParcelClaimed,
} from "../generated/RegistryDiamond/RegistryDiamond";
import { PCOLicenseDiamond as PCOLicenseDiamondTemplate } from "../generated/templates";
import {
  PCOLicenseDiamond,
  TransferTriggered,
  BidAccepted,
  LicenseReclaimed,
  PayerContributionRateUpdated,
  PayerForSalePriceUpdated,
} from "../generated/templates/PCOLicenseDiamond/PCOLicenseDiamond";

const GW_MAX_LAT: u32 = (1 << 22) - 1;
const GW_MAX_LON: u32 = (1 << 23) - 1;

export function handleParcelClaimed(event: ParcelClaimed): void {
  // Entities can be loaded from the store using a string ID; this ID
  // needs to be unique across all entities of the same type
  let parcelEntity = GeoWebParcel.load(event.params._licenseId.toHex());

  // Entities only exist after they have been saved to the store;
  // `null` checks allow to create entities on demand
  if (parcelEntity == null) {
    parcelEntity = new GeoWebParcel(event.params._licenseId.toHex());
  }

  let contract = RegistryDiamond.bind(event.address);
  let parcel = contract.getLandParcel(event.params._licenseId);

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
    saveGWCoord(currentCoord, parcelEntity.id, event);
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
      directionPath.direction,
      GW_MAX_LAT,
      GW_MAX_LON
    );
  } while (true);

  let beaconProxy = contract.getBeaconProxy(event.params._licenseId);

  parcelEntity.coordinates = coordIDs;
  parcelEntity.licenseDiamond = beaconProxy;

  PCOLicenseDiamondTemplate.create(beaconProxy);

  parcelEntity.save();
}

function saveGWCoord(
  gwCoord: u64,
  parcelID: string,
  event: ParcelClaimed
): void {
  let entity = GWCoord.load(gwCoord.toString());

  if (entity == null) {
    entity = new GWCoord(gwCoord.toString());
  }

  let coords = GeoWebCoordinate.to_gps(
    gwCoord,
    GW_MAX_LAT,
    GW_MAX_LON
  ).map<BigDecimal>((v: f64) => {
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

  entity.parcel = parcelID;
  entity.createdAtBlock = event.block.number;
  let coordX: i32 = GeoWebCoordinate.get_x(gwCoord);
  let coordY: i32 = GeoWebCoordinate.get_y(gwCoord);
  entity.coordX = BigInt.fromI32(coordX);
  entity.coordY = BigInt.fromI32(coordY);
  entity.save();
}

export function handleLicenseTransfer(event: Transfer): void {
  let entity = GeoWebParcel.load(event.params.tokenId.toHex());

  if (entity == null) {
    entity = new GeoWebParcel(event.params.tokenId.toHex());
  }

  entity.licenseOwner = event.params.to;
  entity.save();
}

export function handleBidEvent(event: ethereum.Event): void {
  let contract = PCOLicenseDiamond.bind(event.address);

  let parcelEntity = GeoWebParcel.load(contract.licenseId().toHex());
  if (parcelEntity == null) {
    parcelEntity = new GeoWebParcel(contract.licenseId().toHex());
  }

  let currentOwnerBidData = contract.currentBid();

  let currentOwnerBidId =
    contract.payer().toHex() + "-" + contract.licenseId().toHex();
  let currentOwnerBid = Bid.load(currentOwnerBidId);

  if (currentOwnerBid == null) {
    currentOwnerBid = new Bid(currentOwnerBidId);
  }

  currentOwnerBid.timestamp = currentOwnerBidData.timestamp;
  currentOwnerBid.bidder = currentOwnerBidData.bidder.toHex();
  currentOwnerBid.contributionRate = currentOwnerBidData.contributionRate;
  currentOwnerBid.perSecondFeeNumerator =
    currentOwnerBidData.perSecondFeeNumerator;
  currentOwnerBid.perSecondFeeDenominator =
    currentOwnerBidData.perSecondFeeDenominator;
  currentOwnerBid.forSalePrice = currentOwnerBidData.forSalePrice;
  currentOwnerBid.parcel = parcelEntity.id;
  currentOwnerBid.save();

  let currentBidder = Bidder.load(contract.payer().toHex());

  if (currentBidder == null) {
    currentBidder = new Bidder(contract.payer().toHex());
  }

  currentBidder.save();

  let pendingBidData = contract.pendingBid();

  let pendingBidId =
    pendingBidData.bidder.toHex() + "-" + contract.licenseId().toHex();

  let pendingBid = Bid.load(pendingBidId);

  if (pendingBid == null) {
    pendingBid = new Bid(pendingBidId);
  }

  pendingBid.timestamp = pendingBidData.timestamp;
  pendingBid.bidder = pendingBidData.bidder.toHex();
  pendingBid.contributionRate = pendingBidData.contributionRate;
  pendingBid.perSecondFeeNumerator = pendingBidData.perSecondFeeNumerator;
  pendingBid.perSecondFeeDenominator = pendingBidData.perSecondFeeDenominator;
  pendingBid.forSalePrice = pendingBidData.forSalePrice;
  pendingBid.parcel = parcelEntity.id;
  pendingBid.save();

  let pendingBidder = Bidder.load(pendingBidData.bidder.toHex());

  if (pendingBidder == null) {
    pendingBidder = new Bidder(pendingBidData.bidder.toHex());
  }

  pendingBidder.save();

  parcelEntity.pendingBid = pendingBid.id;
  parcelEntity.currentBid = currentOwnerBid.id;
  parcelEntity.save();
}

export function handlePayerContributionUpdate(
  event: PayerContributionRateUpdated
): void {
  let contract = PCOLicenseDiamond.bind(event.address);

  let currentOwnerBidId =
    event.params._payer.toHex() + "-" + contract.licenseId().toHex();
  let currentOwnerBid = Bid.load(currentOwnerBidId);

  if (currentOwnerBid == null) {
    currentOwnerBid = new Bid(currentOwnerBidId);

    let currentOwnerBidData = contract.currentBid();
    currentOwnerBid.timestamp = currentOwnerBidData.timestamp;
    currentOwnerBid.bidder = currentOwnerBidData.bidder.toHex();
    currentOwnerBid.contributionRate = currentOwnerBidData.contributionRate;
    currentOwnerBid.perSecondFeeNumerator =
      currentOwnerBidData.perSecondFeeNumerator;
    currentOwnerBid.perSecondFeeDenominator =
      currentOwnerBidData.perSecondFeeDenominator;
    currentOwnerBid.forSalePrice = currentOwnerBidData.forSalePrice;
    currentOwnerBid.parcel = contract.licenseId().toHex();

    let parcelEntity = GeoWebParcel.load(contract.licenseId().toHex());
    if (parcelEntity == null) {
      parcelEntity = new GeoWebParcel(contract.licenseId().toHex());
    }
    parcelEntity.currentBid = currentOwnerBid.id;
    parcelEntity.save();
  }

  currentOwnerBid.timestamp = event.block.timestamp;
  currentOwnerBid.contributionRate = event.params.contributionRate;
  currentOwnerBid.save();
}

export function handlePayerForSalePriceUpdate(
  event: PayerForSalePriceUpdated
): void {
  let contract = PCOLicenseDiamond.bind(event.address);

  let currentOwnerBidId =
    event.params._payer.toHex() + "-" + contract.licenseId().toHex();
  let currentOwnerBid = Bid.load(currentOwnerBidId);

  if (currentOwnerBid == null) {
    currentOwnerBid = new Bid(currentOwnerBidId);

    let currentOwnerBidData = contract.currentBid();
    currentOwnerBid.timestamp = currentOwnerBidData.timestamp;
    currentOwnerBid.bidder = currentOwnerBidData.bidder.toHex();
    currentOwnerBid.contributionRate = currentOwnerBidData.contributionRate;
    currentOwnerBid.perSecondFeeNumerator =
      currentOwnerBidData.perSecondFeeNumerator;
    currentOwnerBid.perSecondFeeDenominator =
      currentOwnerBidData.perSecondFeeDenominator;
    currentOwnerBid.forSalePrice = currentOwnerBidData.forSalePrice;
    currentOwnerBid.parcel = contract.licenseId().toHex();

    let parcelEntity = GeoWebParcel.load(contract.licenseId().toHex());
    if (parcelEntity == null) {
      parcelEntity = new GeoWebParcel(contract.licenseId().toHex());
    }
    parcelEntity.currentBid = currentOwnerBid.id;
    parcelEntity.save();
  }

  currentOwnerBid.timestamp = event.block.timestamp;
  currentOwnerBid.forSalePrice = event.params.forSalePrice;
  currentOwnerBid.save();
}

export function handleTransferTriggered(event: TransferTriggered): void {
  let contract = PCOLicenseDiamond.bind(event.address);

  let pendingBidId =
    event.params._bidder.toHex() + "-" + contract.licenseId().toHex();

  let parcelEntity = GeoWebParcel.load(contract.licenseId().toHex());
  if (parcelEntity == null) {
    parcelEntity = new GeoWebParcel(contract.licenseId().toHex());
  }
  parcelEntity.currentBid = pendingBidId;
  parcelEntity.pendingBid = null;
  parcelEntity.save();
}

export function handleBidAccepted(event: BidAccepted): void {
  let contract = PCOLicenseDiamond.bind(event.address);

  let pendingBidId =
    event.params._bidder.toHex() + "-" + contract.licenseId().toHex();

  let parcelEntity = GeoWebParcel.load(contract.licenseId().toHex());
  if (parcelEntity == null) {
    parcelEntity = new GeoWebParcel(contract.licenseId().toHex());
  }
  parcelEntity.currentBid = pendingBidId;
  parcelEntity.pendingBid = null;
  parcelEntity.save();
}

export function handleLicenseReclaimed(event: LicenseReclaimed): void {
  let contract = PCOLicenseDiamond.bind(event.address);

  let parcelEntity = GeoWebParcel.load(contract.licenseId().toHex());
  if (parcelEntity == null) {
    parcelEntity = new GeoWebParcel(contract.licenseId().toHex());
  }

  let currentOwnerBidData = contract.currentBid();

  let currentOwnerBidId =
    contract.payer().toHex() + "-" + contract.licenseId().toHex();
  let currentOwnerBid = Bid.load(currentOwnerBidId);

  if (currentOwnerBid == null) {
    currentOwnerBid = new Bid(currentOwnerBidId);
  }

  currentOwnerBid.timestamp = currentOwnerBidData.timestamp;
  currentOwnerBid.bidder = currentOwnerBidData.bidder.toHex();
  currentOwnerBid.contributionRate = currentOwnerBidData.contributionRate;
  currentOwnerBid.perSecondFeeNumerator =
    currentOwnerBidData.perSecondFeeNumerator;
  currentOwnerBid.perSecondFeeDenominator =
    currentOwnerBidData.perSecondFeeDenominator;
  currentOwnerBid.forSalePrice = currentOwnerBidData.forSalePrice;
  currentOwnerBid.parcel = parcelEntity.id;
  currentOwnerBid.save();

  let currentBidder = Bidder.load(contract.payer().toHex());

  if (currentBidder == null) {
    currentBidder = new Bidder(contract.payer().toHex());
  }

  currentBidder.save();

  parcelEntity.pendingBid = null;
  parcelEntity.currentBid = currentOwnerBid.id;
  parcelEntity.save();
}
