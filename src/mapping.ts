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
  u256,
  Direction
} from "as-geo-web-coordinate/assembly";
import { GeoWebParcel, Bidder, Bid } from "../generated/schema";
import {
  Transfer,
  RegistryDiamond,
  ParcelClaimed,
  ParcelClaimedV2
} from "../generated/RegistryDiamond/RegistryDiamond";
import { PCOLicenseDiamond as PCOLicenseDiamondTemplate } from "../generated/templates";
import {
  PCOLicenseDiamond,
  TransferTriggered,
  BidAccepted,
  LicenseReclaimed,
  PayerContributionRateUpdated,
  PayerForSalePriceUpdated,
  PayerContentHashUpdated
} from "../generated/templates/PCOLicenseDiamond/PCOLicenseDiamond";
import { ICFABasePCOV1 } from "../generated/templates/PCOLicenseDiamond/ICFABasePCOV1";
import { ICFAPenaltyBidV1 } from "../generated/templates/PCOLicenseDiamond/ICFAPenaltyBidV1";

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

  parcelEntity.createdAtBlock = event.block.number;

  let contract = RegistryDiamond.bind(event.address);
  let parcel = contract.getLandParcel(event.params._licenseId);

  let numPaths = parcel.value1.length;
  let paths: BigInt[] = parcel.value1;

  let bboxS: f64 = F64.POSITIVE_INFINITY;
  let bboxW: f64 = F64.POSITIVE_INFINITY;
  let bboxN: f64 = F64.NEGATIVE_INFINITY;
  let bboxE: f64 = F64.NEGATIVE_INFINITY;

  let currentCoord = parcel.value0.toU64();
  let currentPath: u256 = new u256(0);
  let p_i = 0;
  let i = 0;
  if (numPaths > 0 && !paths[p_i].isZero()) {
    currentPath = u256.fromUint8ArrayLE(paths[p_i]);
  }
  do {
    let coords = GeoWebCoordinate.to_gps(currentCoord, GW_MAX_LAT, GW_MAX_LON);

    if (bboxW > coords[0]) {
      bboxW = coords[0];
    }
    if (bboxS > coords[1]) {
      bboxS = coords[1];
    }
    if (bboxE < coords[4]) {
      bboxE = coords[4];
    }
    if (bboxN < coords[5]) {
      bboxN = coords[5];
    }

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

  parcelEntity.bboxN = BigDecimal.fromString(bboxN.toString());
  parcelEntity.bboxS = BigDecimal.fromString(bboxS.toString());
  parcelEntity.bboxE = BigDecimal.fromString(bboxE.toString());
  parcelEntity.bboxW = BigDecimal.fromString(bboxW.toString());
  parcelEntity.coordinates = [
    parcelEntity.bboxW!,
    parcelEntity.bboxS!,
    parcelEntity.bboxE!,
    parcelEntity.bboxS!,
    parcelEntity.bboxE!,
    parcelEntity.bboxN!,
    parcelEntity.bboxW!,
    parcelEntity.bboxN!,
    parcelEntity.bboxW!,
    parcelEntity.bboxS!
  ];

  parcelEntity.licenseDiamond = beaconProxy;

  PCOLicenseDiamondTemplate.create(beaconProxy);

  parcelEntity.save();
}

export function handleParcelClaimedV2(event: ParcelClaimedV2): void {
  // Entities can be loaded from the store using a string ID; this ID
  // needs to be unique across all entities of the same type
  let parcelEntity = GeoWebParcel.load(event.params._licenseId.toHex());

  // Entities only exist after they have been saved to the store;
  // `null` checks allow to create entities on demand
  if (parcelEntity == null) {
    parcelEntity = new GeoWebParcel(event.params._licenseId.toHex());
  }

  parcelEntity.createdAtBlock = event.block.number;

  let contract = RegistryDiamond.bind(event.address);
  let parcel = contract.getLandParcelV2(event.params._licenseId);

  let swCoordinate = parcel.value0.toU64();
  let latDim = parcel.value1.toU64();
  let lngDim = parcel.value2.toU64();

  let seCoordinate = swCoordinate;
  let i: u64 = 1;
  while (i < lngDim) {
    seCoordinate = GeoWebCoordinate.traverse(
      seCoordinate,
      Direction.East,
      GW_MAX_LAT,
      GW_MAX_LON
    );
    i++;
  }

  let neCoordinate = seCoordinate;
  i = 1;
  while (i < latDim) {
    neCoordinate = GeoWebCoordinate.traverse(
      neCoordinate,
      Direction.North,
      GW_MAX_LAT,
      GW_MAX_LON
    );
    i++;
  }

  let nwCoordinate = neCoordinate;
  i = 1;
  while (i < lngDim) {
    nwCoordinate = GeoWebCoordinate.traverse(
      nwCoordinate,
      Direction.West,
      GW_MAX_LAT,
      GW_MAX_LON
    );
    i++;
  }

  let bboxS: f64 = F64.POSITIVE_INFINITY;
  let bboxW: f64 = F64.POSITIVE_INFINITY;
  let bboxN: f64 = F64.NEGATIVE_INFINITY;
  let bboxE: f64 = F64.NEGATIVE_INFINITY;

  let allCoords: u64[] = [
    swCoordinate,
    seCoordinate,
    neCoordinate,
    nwCoordinate
  ];

  let a = 0;
  while (a < 4) {
    let coords = GeoWebCoordinate.to_gps(allCoords[a], GW_MAX_LAT, GW_MAX_LON);

    if (bboxW > coords[0]) {
      bboxW = coords[0];
    }
    if (bboxS > coords[1]) {
      bboxS = coords[1];
    }
    if (bboxE < coords[4]) {
      bboxE = coords[4];
    }
    if (bboxN < coords[5]) {
      bboxN = coords[5];
    }

    a++;
  }

  let beaconProxy = contract.getBeaconProxy(event.params._licenseId);
  let pcoLicenseDiamondContract = PCOLicenseDiamond.bind(beaconProxy);

  parcelEntity.bboxN = BigDecimal.fromString(bboxN.toString());
  parcelEntity.bboxS = BigDecimal.fromString(bboxS.toString());
  parcelEntity.bboxE = BigDecimal.fromString(bboxE.toString());
  parcelEntity.bboxW = BigDecimal.fromString(bboxW.toString());
  parcelEntity.coordinates = [
    parcelEntity.bboxW!,
    parcelEntity.bboxS!,
    parcelEntity.bboxE!,
    parcelEntity.bboxS!,
    parcelEntity.bboxE!,
    parcelEntity.bboxN!,
    parcelEntity.bboxW!,
    parcelEntity.bboxN!,
    parcelEntity.bboxW!,
    parcelEntity.bboxS!
  ];

  parcelEntity.licenseDiamond = beaconProxy;

  let contentHash = pcoLicenseDiamondContract.try_contentHash();
  parcelEntity.contentHash = contentHash.reverted ? null : contentHash.value;

  PCOLicenseDiamondTemplate.create(beaconProxy);

  parcelEntity.save();
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
  let cfaPcoBase = ICFABasePCOV1.bind(event.address);
  let cfaPenaltyBid = ICFAPenaltyBidV1.bind(event.address);

  let parcelEntity = GeoWebParcel.load(contract.licenseId().toHex());
  if (parcelEntity == null) {
    parcelEntity = new GeoWebParcel(contract.licenseId().toHex());
  }

  let currentOwnerBidDataV2Res = contract.try_currentBid();
  let currentOwnerBidDataV1 = cfaPcoBase.currentBid();
  let currentOwnerBidId =
    contract.payer().toHex() + "-" + contract.licenseId().toHex();
  let currentOwnerBid = Bid.load(currentOwnerBidId);

  if (currentOwnerBid == null) {
    currentOwnerBid = new Bid(currentOwnerBidId);
  }

  currentOwnerBid.timestamp = currentOwnerBidDataV2Res.reverted
    ? currentOwnerBidDataV1.timestamp
    : currentOwnerBidDataV2Res.value.timestamp;
  currentOwnerBid.bidder = currentOwnerBidDataV2Res.reverted
    ? currentOwnerBidDataV1.bidder.toHex()
    : currentOwnerBidDataV2Res.value.bidder.toHex();
  currentOwnerBid.contributionRate = currentOwnerBidDataV2Res.reverted
    ? currentOwnerBidDataV1.contributionRate
    : currentOwnerBidDataV2Res.value.contributionRate;
  currentOwnerBid.perSecondFeeNumerator = currentOwnerBidDataV2Res.reverted
    ? currentOwnerBidDataV1.perSecondFeeNumerator
    : currentOwnerBidDataV2Res.value.perSecondFeeNumerator;
  currentOwnerBid.perSecondFeeDenominator = currentOwnerBidDataV2Res.reverted
    ? currentOwnerBidDataV1.perSecondFeeDenominator
    : currentOwnerBidDataV2Res.value.perSecondFeeDenominator;
  currentOwnerBid.forSalePrice = currentOwnerBidDataV2Res.reverted
    ? currentOwnerBidDataV1.forSalePrice
    : currentOwnerBidDataV2Res.value.forSalePrice;
  currentOwnerBid.parcel = parcelEntity.id;

  if (currentOwnerBidDataV2Res.reverted) {
    currentOwnerBid.contentHash = null;
  } else {
    currentOwnerBid.contentHash = currentOwnerBidDataV2Res.value.contentHash;
  }

  currentOwnerBid.save();

  let currentBidder = Bidder.load(contract.payer().toHex());

  if (currentBidder == null) {
    currentBidder = new Bidder(contract.payer().toHex());
  }

  currentBidder.save();

  let pendingBidDataV2Res = contract.try_pendingBid();
  let pendingBidDataV1 = cfaPenaltyBid.pendingBid();

  let pendingBidId =
    (pendingBidDataV2Res.reverted
      ? pendingBidDataV1.bidder.toHex()
      : pendingBidDataV2Res.value.bidder.toHex()) +
    "-" +
    contract.licenseId().toHex();

  let pendingBid = Bid.load(pendingBidId);

  if (pendingBid == null) {
    pendingBid = new Bid(pendingBidId);
  }

  pendingBid.timestamp = pendingBidDataV2Res.reverted
    ? pendingBidDataV1.timestamp
    : pendingBidDataV2Res.value.timestamp;
  pendingBid.bidder = pendingBidDataV2Res.reverted
    ? pendingBidDataV1.bidder.toHex()
    : pendingBidDataV2Res.value.bidder.toHex();
  pendingBid.contributionRate = pendingBidDataV2Res.reverted
    ? pendingBidDataV1.contributionRate
    : pendingBidDataV2Res.value.contributionRate;
  pendingBid.perSecondFeeNumerator = pendingBidDataV2Res.reverted
    ? pendingBidDataV1.perSecondFeeNumerator
    : pendingBidDataV2Res.value.perSecondFeeNumerator;
  pendingBid.perSecondFeeDenominator = pendingBidDataV2Res.reverted
    ? pendingBidDataV1.perSecondFeeDenominator
    : pendingBidDataV2Res.value.perSecondFeeDenominator;
  pendingBid.forSalePrice = pendingBidDataV2Res.reverted
    ? pendingBidDataV1.forSalePrice
    : pendingBidDataV2Res.value.forSalePrice;
  pendingBid.parcel = parcelEntity.id;

  if (pendingBidDataV2Res.reverted) {
    pendingBid.contentHash = null;
  } else {
    pendingBid.contentHash = pendingBidDataV2Res.value.contentHash;
  }

  pendingBid.save();

  let pendingBidder = Bidder.load(pendingBid.bidder);

  if (pendingBidder == null) {
    pendingBidder = new Bidder(pendingBid.bidder);
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
  let cfaPcoBase = ICFABasePCOV1.bind(event.address);

  let currentOwnerBidId =
    event.params._payer.toHex() + "-" + contract.licenseId().toHex();
  let currentOwnerBid = Bid.load(currentOwnerBidId);

  let currentOwnerBidDataV2Res = contract.try_currentBid();
  let currentOwnerBidDataV1 = cfaPcoBase.currentBid();

  if (currentOwnerBid == null) {
    currentOwnerBid = new Bid(currentOwnerBidId);

    currentOwnerBid.timestamp = currentOwnerBidDataV2Res.reverted
      ? currentOwnerBidDataV1.timestamp
      : currentOwnerBidDataV2Res.value.timestamp;
    currentOwnerBid.bidder = currentOwnerBidDataV2Res.reverted
      ? currentOwnerBidDataV1.bidder.toHex()
      : currentOwnerBidDataV2Res.value.bidder.toHex();
    currentOwnerBid.contributionRate = currentOwnerBidDataV2Res.reverted
      ? currentOwnerBidDataV1.contributionRate
      : currentOwnerBidDataV2Res.value.contributionRate;
    currentOwnerBid.perSecondFeeNumerator = currentOwnerBidDataV2Res.reverted
      ? currentOwnerBidDataV1.perSecondFeeNumerator
      : currentOwnerBidDataV2Res.value.perSecondFeeNumerator;
    currentOwnerBid.perSecondFeeDenominator = currentOwnerBidDataV2Res.reverted
      ? currentOwnerBidDataV1.perSecondFeeDenominator
      : currentOwnerBidDataV2Res.value.perSecondFeeDenominator;
    currentOwnerBid.forSalePrice = currentOwnerBidDataV2Res.reverted
      ? currentOwnerBidDataV1.forSalePrice
      : currentOwnerBidDataV2Res.value.forSalePrice;
    currentOwnerBid.parcel = contract.licenseId().toHex();
  }

  let parcelEntity = GeoWebParcel.load(contract.licenseId().toHex());
  if (parcelEntity == null) {
    parcelEntity = new GeoWebParcel(contract.licenseId().toHex());
  }

  if (currentOwnerBidDataV2Res.reverted) {
    currentOwnerBid.contentHash = null;
    parcelEntity.contentHash = null;
  } else {
    currentOwnerBid.contentHash = currentOwnerBidDataV2Res.value.contentHash;
    parcelEntity.contentHash = currentOwnerBidDataV2Res.value.contentHash;
  }
  currentOwnerBid.timestamp = event.block.timestamp;
  currentOwnerBid.contributionRate = event.params.contributionRate;
  currentOwnerBid.save();

  parcelEntity.currentBid = currentOwnerBid.id;
  parcelEntity.save();

  let currentBidder = Bidder.load(contract.payer().toHex());

  if (currentBidder == null) {
    currentBidder = new Bidder(contract.payer().toHex());
    currentBidder.save();
  }
}

export function handlePayerForSalePriceUpdate(
  event: PayerForSalePriceUpdated
): void {
  let contract = PCOLicenseDiamond.bind(event.address);
  let cfaPcoBase = ICFABasePCOV1.bind(event.address);

  let currentOwnerBidId =
    event.params._payer.toHex() + "-" + contract.licenseId().toHex();
  let currentOwnerBid = Bid.load(currentOwnerBidId);

  let currentOwnerBidDataV2Res = contract.try_currentBid();
  let currentOwnerBidDataV1 = cfaPcoBase.currentBid();

  if (currentOwnerBid == null) {
    currentOwnerBid = new Bid(currentOwnerBidId);

    currentOwnerBid.timestamp = currentOwnerBidDataV2Res.reverted
      ? currentOwnerBidDataV1.timestamp
      : currentOwnerBidDataV2Res.value.timestamp;
    currentOwnerBid.bidder = currentOwnerBidDataV2Res.reverted
      ? currentOwnerBidDataV1.bidder.toHex()
      : currentOwnerBidDataV2Res.value.bidder.toHex();
    currentOwnerBid.contributionRate = currentOwnerBidDataV2Res.reverted
      ? currentOwnerBidDataV1.contributionRate
      : currentOwnerBidDataV2Res.value.contributionRate;
    currentOwnerBid.perSecondFeeNumerator = currentOwnerBidDataV2Res.reverted
      ? currentOwnerBidDataV1.perSecondFeeNumerator
      : currentOwnerBidDataV2Res.value.perSecondFeeNumerator;
    currentOwnerBid.perSecondFeeDenominator = currentOwnerBidDataV2Res.reverted
      ? currentOwnerBidDataV1.perSecondFeeDenominator
      : currentOwnerBidDataV2Res.value.perSecondFeeDenominator;
    currentOwnerBid.forSalePrice = currentOwnerBidDataV2Res.reverted
      ? currentOwnerBidDataV1.forSalePrice
      : currentOwnerBidDataV2Res.value.forSalePrice;
    currentOwnerBid.parcel = contract.licenseId().toHex();
  }

  let parcelEntity = GeoWebParcel.load(contract.licenseId().toHex());
  if (parcelEntity == null) {
    parcelEntity = new GeoWebParcel(contract.licenseId().toHex());
  }

  if (currentOwnerBidDataV2Res.reverted) {
    currentOwnerBid.contentHash = null;
    parcelEntity.contentHash = null;
  } else {
    currentOwnerBid.contentHash = currentOwnerBidDataV2Res.value.contentHash;
    parcelEntity.contentHash = currentOwnerBidDataV2Res.value.contentHash;
  }
  currentOwnerBid.timestamp = event.block.timestamp;
  currentOwnerBid.forSalePrice = event.params.forSalePrice;
  currentOwnerBid.save();

  parcelEntity.currentBid = currentOwnerBid.id;
  parcelEntity.save();

  let currentBidder = Bidder.load(contract.payer().toHex());

  if (currentBidder == null) {
    currentBidder = new Bidder(contract.payer().toHex());
    currentBidder.save();
  }
}

export function handlePayerContentHashUpdate(
  event: PayerContentHashUpdated
): void {
  let contract = PCOLicenseDiamond.bind(event.address);

  let currentOwnerBidId =
    event.params._payer.toHex() + "-" + contract.licenseId().toHex();
  let currentOwnerBid = Bid.load(currentOwnerBidId);

  let currentOwnerBidDataV2Res = contract.try_currentBid();

  if (currentOwnerBid == null) {
    currentOwnerBid = new Bid(currentOwnerBidId);
  }

  let parcelEntity = GeoWebParcel.load(contract.licenseId().toHex());
  if (parcelEntity == null) {
    parcelEntity = new GeoWebParcel(contract.licenseId().toHex());
  }

  if (currentOwnerBidDataV2Res.reverted) {
    currentOwnerBid.contentHash = null;
    parcelEntity.contentHash = null;
  } else {
    currentOwnerBid.contentHash = currentOwnerBidDataV2Res.value.contentHash;
    parcelEntity.contentHash = currentOwnerBidDataV2Res.value.contentHash;
  }
  currentOwnerBid.save();

  parcelEntity.currentBid = currentOwnerBid.id;
  parcelEntity.save();
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
  let cfaPcoBase = ICFABasePCOV1.bind(event.address);

  let parcelEntity = GeoWebParcel.load(contract.licenseId().toHex());
  if (parcelEntity == null) {
    parcelEntity = new GeoWebParcel(contract.licenseId().toHex());
  }

  let currentOwnerBidDataV2Res = contract.try_currentBid();
  let currentOwnerBidDataV1 = cfaPcoBase.currentBid();

  let currentOwnerBidId =
    contract.payer().toHex() + "-" + contract.licenseId().toHex();
  let currentOwnerBid = Bid.load(currentOwnerBidId);

  if (currentOwnerBid == null) {
    currentOwnerBid = new Bid(currentOwnerBidId);
  }

  currentOwnerBid.timestamp = currentOwnerBidDataV2Res.reverted
    ? currentOwnerBidDataV1.timestamp
    : currentOwnerBidDataV2Res.value.timestamp;
  currentOwnerBid.bidder = currentOwnerBidDataV2Res.reverted
    ? currentOwnerBidDataV1.bidder.toHex()
    : currentOwnerBidDataV2Res.value.bidder.toHex();
  currentOwnerBid.contributionRate = currentOwnerBidDataV2Res.reverted
    ? currentOwnerBidDataV1.contributionRate
    : currentOwnerBidDataV2Res.value.contributionRate;
  currentOwnerBid.perSecondFeeNumerator = currentOwnerBidDataV2Res.reverted
    ? currentOwnerBidDataV1.perSecondFeeNumerator
    : currentOwnerBidDataV2Res.value.perSecondFeeNumerator;
  currentOwnerBid.perSecondFeeDenominator = currentOwnerBidDataV2Res.reverted
    ? currentOwnerBidDataV1.perSecondFeeDenominator
    : currentOwnerBidDataV2Res.value.perSecondFeeDenominator;
  currentOwnerBid.forSalePrice = currentOwnerBidDataV2Res.reverted
    ? currentOwnerBidDataV1.forSalePrice
    : currentOwnerBidDataV2Res.value.forSalePrice;
  currentOwnerBid.parcel = parcelEntity.id;

  if (currentOwnerBidDataV2Res.reverted) {
    currentOwnerBid.contentHash = null;
  } else {
    currentOwnerBid.contentHash = currentOwnerBidDataV2Res.value.contentHash;
  }
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
