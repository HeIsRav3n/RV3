'use strict';

const opensea = require('./opensea');
const prices = require('./prices');

async function floorEthForSlug(slug) {
  if (!slug) return null;
  try {
    const stats = await opensea.getCollectionStats(slug);
    const floor = stats?.total?.floor_price ?? stats?.floor_price;
    return floor != null ? parseFloat(floor) : null;
  } catch {
    return null;
  }
}

async function enrichHistory(history) {
  const ethUsd = await prices.getEthUsd();
  const slugCache = {};
  return Promise.all(history.map(async run => {
    const slug = run.openseaSlug;
    let floorEth = null;
    if (slug) {
      if (slugCache[slug] != null) floorEth = slugCache[slug];
      else {
        floorEth = await floorEthForSlug(slug);
        slugCache[slug] = floorEth;
      }
    }
    const gasEth = run.gasEth || 0;
    const minted = run.minted || 0;
    const mintCostEth = run.mintCostEth || 0;
    const totalCostEth = gasEth + mintCostEth;
    const unrealizedEth = floorEth != null ? floorEth * minted - totalCostEth : null;
    return {
      ...run,
      floorEth,
      floorUsd: floorEth != null ? floorEth * ethUsd : null,
      totalCostEth,
      totalCostUsd: totalCostEth * ethUsd,
      unrealizedEth,
      unrealizedUsd: unrealizedEth != null ? unrealizedEth * ethUsd : null,
    };
  }));
}

module.exports = { enrichHistory, floorEthForSlug };
