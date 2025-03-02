const sdk = require('@defillama/sdk');
const axios = require('axios');

const utils = require('../utils');
const abiPairFactory = require('./abiPairFactory.json');
const abiPair = require('./abiPair.json');
const abiGauge = require('./abiGauge.json');
const abiVoter = require('./abiVoter.json');

const CHAINS = {
  fantom: {
    pairFactory: '0xc6366EFD0AF1d09171fe0EBF32c7943BB310832a',
    voter: '0xE3D1A117dF7DCaC2eB0AC8219341bAd92f18dAC1',
    EQUAL: '0x3Fd3A0c85B70754eFc07aC9Ac0cbBDCe664865A6',
  },
  sonic: {
    pairFactory: '0xDDD9845Ba0D8f38d3045f804f67A1a8B9A528FcC',
    voter: '0x17fa9dA6e01aD59513707F92033a6eb03CcB10B4',
    EQUAL: '0xddf26b42c1d903de8962d3f79a74a501420d5f19',
  },
};

const getApy = async (chain) => {
  const pairFactory = CHAINS[chain].pairFactory;
  const voter = CHAINS[chain].voter;
  const EQUAL = CHAINS[chain].EQUAL;

  const allPairsLength = (
    await sdk.api.abi.call({
      target: pairFactory,
      abi: abiPairFactory.find((m) => m.name === 'allPairsLength'),
      chain,
      permitFailure: true,
    })
  ).output;

  const allPairs = (
    await sdk.api.abi.multiCall({
      calls: [...Array(Number(allPairsLength)).keys()].map((i) => ({
        target: pairFactory,
        params: [i],
      })),
      abi: abiPairFactory.find((m) => m.name === 'allPairs'),
      chain,
      permitFailure: true,
    })
  ).output.map((o) => o.output);

  const metaData = (
    await sdk.api.abi.multiCall({
      calls: allPairs.map((i) => ({
        target: i,
      })),
      abi: abiPair.find((m) => m.name === 'metadata'),
      chain,
      permitFailure: true,
    })
  ).output.map((o) => o.output);

  const symbols = (
    await sdk.api.abi.multiCall({
      calls: allPairs.map((i) => ({
        target: i,
      })),
      abi: abiPair.find((m) => m.name === 'symbol'),
      chain,
      permitFailure: true,
    })
  ).output.map((o) => o.output);

  const gauges = (
    await sdk.api.abi.multiCall({
      calls: allPairs.map((i) => ({
        target: voter,
        params: [i],
      })),
      abi: abiVoter.find((m) => m.name === 'gauges'),
      chain,
      permitFailure: true,
    })
  ).output.map((o) => o.output);

  const rewardRate = (
    await sdk.api.abi.multiCall({
      calls: gauges.map((i) => ({
        target: i,
        params: [EQUAL],
      })),
      abi: abiGauge.find((m) => m.name === 'rewardRate'),
      chain,
      permitFailure: true,
    })
  ).output.map((o) => o.output);

  const tokens = [
    ...new Set(
      metaData
        .map((m) => [m.t0, m.t1])
        .flat()
        .concat(EQUAL)
    ),
  ];

  const maxSize = 50;
  const pages = Math.ceil(tokens.length / maxSize);
  let pricesA = [];
  let keys = '';
  for (const p of [...Array(pages).keys()]) {
    keys = tokens
      .slice(p * maxSize, maxSize * (p + 1))
      .map((i) => `${chain}:${i}`)
      .join(',')
      .replaceAll('/', '');
    pricesA = [
      ...pricesA,
      (await axios.get(`https://coins.llama.fi/prices/current/${keys}`)).data
        .coins,
    ];
  }
  let prices = {};
  for (const p of pricesA) {
    prices = { ...prices, ...p };
  }

  const pools = allPairs.map((p, i) => {
    const poolMeta = metaData[i];
    const r0 = poolMeta.r0 / poolMeta.dec0;
    const r1 = poolMeta.r1 / poolMeta.dec1;

    const p0 = prices[`${chain}:${poolMeta.t0}`]?.price;
    const p1 = prices[`${chain}:${poolMeta.t1}`]?.price;

    const tvlUsd = r0 * p0 + r1 * p1;

    const s = symbols[i];

    const rewardPerSec =
      (rewardRate[i] / 1e18) * prices[`${chain}:${EQUAL}`]?.price;
    const apyReward = ((rewardPerSec * 86400 * 365) / tvlUsd) * 100;

    return {
      pool: p,
      chain: utils.formatChain(chain),
      project: 'equalizer-exchange',
      symbol: utils.formatSymbol(s.split('-')[1]),
      tvlUsd,
      apyReward,
      rewardTokens: apyReward ? [EQUAL] : [],
      underlyingTokens: [poolMeta.t0, poolMeta.t1],
    };
  });

  return pools.filter((p) => utils.keepFinite(p));
};

const apy = async () => {
  const pools = (
    await Promise.all(
      Object.keys(CHAINS).map(async (chain) => {
        return await getApy(chain);
      })
    )
  ).flat();
  return pools;
};

module.exports = {
  timetravel: false,
  apy,
  url: 'https://equalizer.exchange/liquidity',
};
