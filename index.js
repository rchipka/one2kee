'use strict';

require('sugar')();

var fs     = require('fs'),
    path   = require('path'),
    args   = require('args'),
    csv    = require('csv'),
    libxml = require('libxmljs'),
    c2x    = require('css2xpath'),
    uuidv4 = require('uuid/v4');

args
  .option('columns', 'Comma-separated list of columns')
  .option('append', 'KeePass XML file to append to')
  .option('group', 'Group to append entries to')
  .option('entry-group', 'Column to determine group from');

var parseOpts = {
  recover: true
};

var flags = args.parse(process.argv),
    document, columns, group,
    csvOpts = {
      relax: true,
      trim: true,
      escape: '\\',
    }, keyRegex = /\s*\(([a-z0-9\_\-]+)\)\s*/i;

if (flags.columns) {
  if (typeof flags.columns === 'string') {
    columns = flags.columns.split(/,\s*/).map(function (v) {
      return v.toLowerCase().replace('word','').replace('user','');
    });
  } else {
    columns = csvOpts.columns = true;
  }
} else {
  throw new Error('No columns specified. Use --columns to specify columns.');
}

console.error('Columns:', columns);

if (!flags.append) {
  console.error('Creating new XML document');
  document = new libxml.parseXml(fs.readFileSync(__dirname + '/example.xml'), parseOpts);
} else {
  console.error('Reading XML document from ' + JSON.stringify(flags.append));
  document = libxml.parseXml(fs.readFileSync(flags.append), parseOpts);
}

if (!flags.group) {
  flags.group = 'Imported';
}

group = findGroupByName(flags.group);

if (!group) {
  console.error('No group found for ' + JSON.stringify(flags.group) + ', creating root group');

  document.get(c2x('Root')).addChild(createGroup({
    name: flags.group
  }));

  group = findGroupByName(flags.group);
} else {
  console.error('Found group ' + group.toString());
}

var parser = csv.parse(csvOpts).on('readable', function() {
  var row, rowIndex = 0;

  while (row = parser.read()) {
    rowIndex++;

    if (columns instanceof Array) {
      var data = {},
          hasData = false;

      columns.forEach(function (column, index) {
        if (!row[index]) {
          return;
        }

        hasData = true;

        data[column] = row[index];
      });

      if (!hasData) {
        // console.error('No column values for row #' + rowIndex + ' ' + row.join(', '));
        continue;
      }
    } else {
      data = row;
    }

    if (flags.entryGroup && data[flags.entryGroup]) {
      var groupColumn = data[flags.entryGroup];
      var childGroup = findGroupByName(groupColumn);

      if (!childGroup) {
        // if (!flags.group || flags.group == 'Imported') {
        //   document.get('//Root').addChild(createGroup({
        //     name: groupColumn
        //   }));
        // } else {
          group.addChild(createGroup({
            name: groupColumn
          }));
        // }

        childGroup = findGroupByName(groupColumn);
      }

      childGroup.addChild(createEntry(data));
      continue;
    }

    group.addChild(createEntry(data));
  }
}).on('end', function () {
  console.log(document.toString({format: true}));
});

function uuid() {
  return new Buffer(uuidv4()).toString('base64').substr(0, 20) + 'Ig==';
}

function findGroupByName(name) {
  if (!name) {
    return;
  }

  var group = document.get(c2x('Group > Name:contains(' + JSON.stringify(name) + ')'));

  if (!group) {
    return group;
  }

  return group.parent();
}

function createGroup(data) {
  var dates = [
        new Date(getProp(data, ['created', 'Created Date']) * 1000),
        new Date(getProp(data, ['modified', 'Modified Date']) * 1000),
      ].map(function (v) {
        return '2017-12-20T18:25:28.372Z';

        if (v.getTime() < (1513796400 * 1000)) {
          v = new Date();
        }

        return JSON.stringify(v).replace(/\"/g, '');
      });

  var xml = 
       ` <Group>
            <UUID>${uuid()}</UUID>
            <Name>${data.name}</Name>
            <Notes />
            <IconID>49</IconID>
            <Times>
                <CreationTime>${dates[0]}</CreationTime>
                <LastModificationTime>${dates[1]}</LastModificationTime>
                <LastAccessTime>${dates[1]}</LastAccessTime>
                <Expires>False</Expires>
                <UsageCount>0</UsageCount>
            </Times>
            <IsExpanded>False</IsExpanded>
            <DefaultAutoTypeSequence />
            <EnableAutoType>null</EnableAutoType>
            <EnableSearching>null</EnableSearching>
            <LastTopVisibleEntry>AAAAAAAAAAAAAAAAAAAAAA==</LastTopVisibleEntry>
        </Group>`,
        group = libxml.parseXml(xml, parseOpts).get('//Group');

  return group;
}

function createEntry(data) {
  var dates = [
        new Date(getProp(data, ['created', 'Created Date']) * 1000),
        new Date(getProp(data, ['modified', 'Modified Date']) * 1000),
      ].map(function (v) {
        // return '2017-12-20T18:25:28.372Z';
        if (v.getTime() < (946681200 * 1000)) {
          v = new Date();
        }

        return JSON.stringify(v).replace(/\"/g, '');
      }),
      xml = `
        
        <Entry>
          <UUID>${uuid()}</UUID>
          <Tags />
          <Times>
              <CreationTime>${dates[0]}</CreationTime>
              <LastModificationTime>${dates[1]}</LastModificationTime>
              <LastAccessTime>${dates[1]}</LastAccessTime>
              <Expires>False</Expires>
              <UsageCount>0</UsageCount>
          </Times>
        `,
      entry,
      newData = {};

    Object.keys(data).map(function (key) {
      var parens = '',
          skey = key.replace(/name/ig, ' Name').replace(/username/, 'UserName').replace(/[_\)\(]+/g, ' ').replace(keyRegex, function (v) {
            parens = v;
          }).replace(/\s{2,}/g, ' ').trim(),
          newKey = [skey.split(' '), parens.split(' ')].flatten().compact(true).unique(function (v) {
            return v.toLowerCase().trim();
          }).map(function (v) {
            return v.replace(/^[a-z]/, function (v) {
              return v.toUpperCase();
            });
          }).join(' ').trim().replace(/\s+Name/ig, 'Name');

      if (!newData[newKey]) {
        newData[newKey] = [];
      }

      newData[newKey].push(data[key]);

      if (!newData.Title) {
        newData.Title = newData.URL;
      }

      return newKey;
    }).unique().forEach(function (key) {
      var attrs = '',
          key = key,
          skey = key,
          value = newData[key].map(function(v) {
            return v.replace(/(^\{\(|\)\}$)/g, '').trim().toString('utf8');
          }).unique().join('\n'),
          entryXml = '';

      if (value.length < 1) {
        return;
      }

      if (/date$/i.test(skey)) {
        return;
      }

      if (/(passw|pass$)/i.test(key)) {
        attrs += ' ProtectInMemory="True"';
      }

      entryXml = `
      <String>
        <Key>${skey}</Key>
        <Value${attrs}></Value>
      </String>
      `;

      var stringNode = libxml.parseXml(entryXml, parseOpts).get('//String');

      stringNode.get('//Value').text(value);

      xml += stringNode.toString();
    });

    xml += `
        <AutoType>
            <Enabled>True</Enabled>
            <DataTransferObfuscation>0</DataTransferObfuscation>
        </AutoType>
      <History />
    </Entry>`;

    entry = libxml.parseXml(xml, parseOpts).get('//Entry');

  return entry;
}

function getProp(data, props) {
  for (var i = 0; i < props.length; i++) {
    var key = props[i];

    if (!data[key]) {
      continue;
    }

    return data[key];
  }

  return;
}

function setTimes(node) {
  return node;
}

process.stdin.pipe(parser);