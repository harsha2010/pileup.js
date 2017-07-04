/**
 * Caching & prefetching for VCF sources.
 *
 * @flow
 */
'use strict';


import Events from 'backbone';
import _ from 'underscore';
import Q from 'q';

import ContigInterval from '../ContigInterval';
import RemoteFile from '../RemoteFile';
import LocalStringFile from '../LocalStringFile';
import {VcfFile} from '../data/vcf';
import {Variant} from '../data/vcf';

export type VcfDataSource = {
  rangeChanged: (newRange: GenomeRange) => void;
  getFeaturesInRange: (range: ContigInterval<string>) => Variant[];
  on: (event: string, handler: Function) => void;
  off: (event: string) => void;
  trigger: (event: string, ...args:any) => void;
};


var BASE_PAIRS_PER_FETCH = 100;
var ZERO_BASED = false;

function variantKey(v: Variant): string {
  return `${v.contig}:${v.position}`;
}


function createFromVcfFile(remoteSource: VcfFile): VcfDataSource {
  var variants: {[key: string]: Variant} = {};

  // Ranges for which we have complete information -- no need to hit network.
  var coveredRanges: ContigInterval<string>[] = [];

  function addVariant(v: Variant) {
    var key = variantKey(v);
    if (!variants[key]) {
      variants[key] = v;
    }
  }

  function fetch(range: GenomeRange) {
    var interval = new ContigInterval(range.contig, range.start, range.stop);

    // Check if this interval is already in the cache.
    if (interval.isCoveredBy(coveredRanges)) {
      return Q.when();
    }

    interval = interval.round(BASE_PAIRS_PER_FETCH, ZERO_BASED);

    // "Cover" the range immediately to prevent duplicate fetches.
    coveredRanges.push(interval);
    coveredRanges = ContigInterval.coalesce(coveredRanges);
    return remoteSource.getFeaturesInRange(interval).then(variants => {
      variants.forEach(variant => addVariant(variant));
      o.trigger('newdata', interval);
    });
  }

  function getFeaturesInRange(range: ContigInterval<string>): Variant[] {
    if (!range) return [];  // XXX why would this happen?
    return _.filter(variants, v => range.chrContainsLocus(v.contig, v.position));
  }

  var o = {
    rangeChanged: function(newRange: GenomeRange) {
      fetch(newRange).done();
    },
    getFeaturesInRange,

    // These are here to make Flow happy.
    on: () => {},
    off: () => {},
    trigger: () => {}
  };
  _.extend(o, Events);  // Make this an event emitter

  return o;
}

function create(data: {url?: string, content?: string}): VcfDataSource {
  var {url, content} = data;
  if (url) {
    return createFromVcfFile(new VcfFile(new RemoteFile(url)));
  } else if (content) {
    return createFromVcfFile(new VcfFile(new LocalStringFile(content)));
  }
  // If no URL or content is passed, fail
  throw new Error(`Missing URL or content from track: ${JSON.stringify(data)}`);
}

module.exports = {
  create,
  createFromVcfFile
};
